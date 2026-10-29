import { Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { CreateEspacioRequest } from '../../../../api/generated/model/create-espacio-request';
import { EspaciosService } from '../../../../api/generated/api/espacios.service';
import { EspacioResponseTipoEnum } from '../../../../api/generated/model/espacio-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CausaEspacio, traducirErrorEspacio } from '../../models/espacio-errors';
import { TIPOS_DE_ESPACIO } from '../../models/tipos-de-espacio';
import { aInstanteUtc } from '../../../../shared/utils/instantes';
import { crearEsperaPorLimite } from '../../../../shared/utils/espera-por-limite';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { publicarMigas } from '../../../../core/services/migas.store';

/** Estado del alta. Los cuatro casos exigen pantalla distinta (ADR-0005). */
type EstadoAlta =
  | { readonly tipo: 'editando' }
  | { readonly tipo: 'enviando' }
  | { readonly tipo: 'ok'; readonly nombre: string }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly causa: CausaEspacio };

/**
 * Alta de un espacio en la sede activa (M04, RF-M04-001, AKINE-02.02).
 *
 * <p>Consume `POST /organizations/{orgId}/consultorios/{consultorioId}/espacios`, que exige
 * `consultorio:manage` <b>sobre esa sede</b>. La sede es la del contexto de trabajo: no se
 * elige aca ni viaja por la URL.
 *
 * <p><b>Un solo paso, y no dos como el alta de una sede.</b> Lo unico obligatorio es el
 * nombre y los cuatro campos restantes tienen defaults utiles -`BOX`, capacidad 1, en servicio
 * desde ahora, sin fin previsto-, que es el caso mas frecuente: dar de alta el box 3. Partirlo
 * en dos pasos le agregaria una pantalla a un formulario que se completa escribiendo dos
 * palabras.
 *
 * <p><b>Sin `Idempotency-Key`, y es del contrato.</b> A diferencia del alta de una sede, aca
 * el backend no lo pide: un espacio no consume cupo de ningun plan, asi que lo unico que un
 * reintento podria producir es una fila duplicada, y contra eso el unique de nombre entre los
 * espacios vigentes es una garantia mas fuerte que una clave -no depende de que el cliente la
 * mande ni de que la reuse bien-. El reintento responde `409 espacio-name-taken` y no crea
 * nada. La contrapartida la asume esta pantalla: tras un fallo de red se avisa que hay que
 * <b>releer el listado</b> para saber si el alta original entro, en vez de invitar a reenviar
 * a ciegas.
 *
 * <p><b>La ventana de vigencia no es la baja.</b> `validFrom`/`validUntil` dicen cuando el
 * espacio se ofrece para reservar; la baja logica dice si existe. Un box cargado hoy que abre
 * el mes que viene se da de alta con `validFrom` futuro y queda ACTIVO pero sin servicio, que
 * es correcto: el formulario lo dice antes de enviar para que nadie lo reporte despues como un
 * bug de la agenda.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Un alta a medio llenar bajo la Sede A no puede
 * enviarse bajo la B: el formulario se descarta entero con el cambio de contexto.
 */
@Component({
  selector: 'app-new-espacio-page',
  imports: [CabeceraDePagina, Ayuda, ReactiveFormsModule, RouterLink, Alerta],
  templateUrl: './new-espacio-page.html',
  styleUrl: '../../resource.css',
})
export class NewEspacioPage {
  /** Ruta de navegacion de la barra superior (UX-13). */
  private readonly migasDeLaBarra = publicarMigas(() => [
    { etiqueta: 'Espacios y boxes', ruta: '/espacios' },
    { etiqueta: 'Dar de alta' },
  ]);

  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly espacios = inject(EspaciosService);
  private readonly avisos = inject(AvisosStore);
  private readonly router = inject(Router);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly tipos = TIPOS_DE_ESPACIO;
  protected readonly espera = crearEsperaPorLimite();

  protected readonly nombreDeLaSede = computed(
    () => this.tenantContext.context()?.consultorioName ?? 'la sede activa',
  );

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    name: ['', [textoRequerido]],
    tipo: [EspacioResponseTipoEnum.BOX as string],
    capacidad: ['1', [Validators.min(1)]],
    notes: [''],
    // Vacio significa "desde ahora": el contrato lo expresa OMITIENDO el campo.
    validFrom: [''],
    validUntil: [''],
  });

  protected readonly estado = signal<EstadoAlta>({ tipo: 'editando' });
  protected readonly intentos = signal(0);

  protected readonly enviando = computed(() => this.estado().tipo === 'enviando');
  protected readonly hecho = computed(() => this.estado().tipo === 'ok');

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly causaError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.causa : null;
  });

  /** El conflicto de nombre unico se muestra EN el campo nombre, no al pie. */
  protected readonly errorEnElNombre = computed(() => this.causaError() === 'nombre-tomado');

  /**
   * Sin `Idempotency-Key`, un fallo de red deja la duda de si el alta entro.
   *
   * <p>La salida honesta es releer el listado, no reenviar: si el `POST` original si llego, el
   * reenvio responde `409 espacio-name-taken` -no duplica nada, pero confunde-.
   */
  protected readonly dudaPorRed = computed(() => this.causaError() === 'red');

  /** El alta no tiene sentido sin una sede elegida: no hay donde crear el espacio. */
  protected readonly sinSede = computed(() => this.tenantContext.consultorioId() === null);

  protected readonly bloqueado = computed(
    () => this.enviando() || this.hecho() || this.espera.activa() || this.sinSede(),
  );

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.formulario.reset({
          name: '',
          tipo: EspacioResponseTipoEnum.BOX,
          capacidad: '1',
          notes: '',
          validFrom: '',
          validUntil: '',
        });
        this.estado.set({ tipo: 'editando' });
        this.intentos.set(0);
      });
    });
  }

  protected mostrarError(nombre: 'name' | 'capacidad'): boolean {
    const control = this.formulario.controls[nombre];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * `aria-describedby` del campo nombre. Metodo y no `computed`: ver la pantalla de listado.
   */
  protected descritoNombre(): string | null {
    if (this.errorEnElNombre()) {
      return 'espacio-name-conflicto';
    }
    return this.mostrarError('name') ? 'espacio-name-error' : 'espacio-name-ayuda';
  }

  protected enviar(): void {
    this.intentos.update((valor) => valor + 1);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      // Foco al primer campo invalido tras un submit fallido: sin esto, quien navega por
      // teclado se queda parado en el boton y no se entera de que hay un error mas arriba.
      this.enfocar(this.formulario.controls.name.invalid ? '#espacio-name' : '#espacio-capacidad');
      return;
    }

    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();
    if (orgId === null || consultorioId === null || this.bloqueado()) {
      return;
    }

    const cuerpo = this.armarCuerpo();
    this.estado.set({ tipo: 'enviando' });

    this.espacios.createEspacio({ orgId, consultorioId, createEspacioRequest: cuerpo }).subscribe({
      next: (espacio) => {
        const nombre = espacio.name ?? cuerpo.name;
        this.estado.set({ tipo: 'ok', nombre });
        // Pantalla propia de alta (UX-12): vuelve al listado y publica el aviso, que sobrevive a
        // la navegacion porque vive en el shell. La aclaracion de la fecha futura solo suma si
        // se cargo un inicio: es cuando la fila va a figurar "activo pero todavía sin servicio".
        this.avisos.exito('Espacio dado de alta', {
          descripcion:
            cuerpo.validFrom === undefined
              ? `${nombre} · ${this.nombreDeLaSede()}`
              : `${nombre} · ${this.nombreDeLaSede()}. Si su inicio es futuro, figura sin ` +
                'servicio hasta esa fecha.',
        });
        this.router
          .navigateByUrl('/espacios')
          .catch((error: unknown) => console.error('No se pudo abrir el listado', error));
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /**
   * Arma el cuerpo omitiendo lo que no se cargo.
   *
   * <p>Los opcionales vacios se <b>omiten</b> y no se mandan como cadena vacia: en un alta una
   * cadena vacia no significa "sin dato" sino un dato vacio, y en `validFrom` seria
   * directamente un instante invalido que el backend rechaza con `400`. Omitir `validFrom` es
   * lo que pide "desde ahora", y omitir `validUntil` es lo que pide "sin fin previsto".
   */
  private armarCuerpo(): CreateEspacioRequest {
    const valores = this.formulario.getRawValue();
    const cuerpo: CreateEspacioRequest = { name: valores.name.trim() };

    if (valores.tipo !== '') {
      cuerpo.tipo = valores.tipo as CreateEspacioRequest['tipo'];
    }

    // `numeroDeclarado` y no `valores.capacidad !== ''`: un `input type="number"` vaciado entrega
    // `null`, no `''`, asi que la guarda vieja dejaba pasar `Number(null) === 0` como si el
    // usuario hubiera escrito un cero. Un box de capacidad 0 es un 400 del backend.
    const capacidad = numeroDeclarado(valores.capacidad);
    if (capacidad !== null) {
      cuerpo.capacidad = capacidad;
    }

    const notas = valores.notes.trim();
    if (notas !== '') {
      cuerpo.notes = notas;
    }

    const desde = aInstanteUtc(valores.validFrom, this.diaDeLaSede.zona());
    if (desde !== null) {
      cuerpo.validFrom = desde;
    }

    const hasta = aInstanteUtc(valores.validUntil, this.diaDeLaSede.zona());
    if (hasta !== null) {
      cuerpo.validUntil = hasta;
    }

    return cuerpo;
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorEspacio(error);

    if (traducido.causa === 'limite') {
      this.espera.iniciar(traducido.segundosDeEspera);
    }

    this.estado.set({ tipo: 'error', mensaje: traducido.mensaje, causa: traducido.causa });

    // El conflicto de nombre aterriza en el campo: hay que llevar el foco ahi, o el mensaje
    // aparece fuera de la vista y el usuario reenvia lo mismo.
    if (traducido.causa === 'nombre-tomado') {
      this.enfocar('#espacio-name');
    }
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
