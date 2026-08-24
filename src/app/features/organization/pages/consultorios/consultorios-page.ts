import { Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ConsultorioPageResponse } from '../../../../api/generated/model/consultorio-page-response';
import { ConsultorioResponse } from '../../../../api/generated/model/consultorio-response';
import { ConsultoriosService } from '../../../../api/generated/api/consultorios.service';
import { OrganizacionesService } from '../../../../api/generated/api/organizaciones.service';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { RUTA_SELECTOR_CONTEXTO } from '../../../../core/models/rutas';
import { SedesDelContexto } from '../../services/sedes-del-contexto';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateConsultorioRequest } from '../../../../api/generated/model/update-consultorio-request';
import { CausaConsultorio, traducirErrorConsultorio } from '../../models/consultorio-errors';
import { MOTIVO_SEDE_INACTIVA, PARAM_MOTIVO } from '../../models/motivo-de-seleccion';
import { etiquetaDeZona, zonasHorarias } from '../../models/zonas-horarias';

/** Filtro de estado del listado. Los tres valores son los del contrato. */
type FiltroEstado = 'ACTIVO' | 'INACTIVO' | 'TODOS';

/** Estado del listado (ADR-0005: los cuatro casos son pantallas distintas). */
type EstadoListado =
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly pagina: ConsultorioPageResponse }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'baja';

/** Campos institucionales: los unicos que el `PATCH` puede BORRAR con una cadena vacia. */
const CAMPOS_INSTITUCIONALES = [
  'legalName',
  'taxId',
  'addressLine',
  'phone',
  'contactEmail',
] as const;

/**
 * Cuantas sedes se piden por pagina.
 *
 * <p>Muy por debajo del tope de 100 que el backend recorta. Ningun centro real tiene
 * decenas de sedes, y cada fila trae acciones: una tabla mas larga no se lee mejor.
 */
const POR_PAGINA = 20;

/**
 * Sedes (consultorios) de la organizacion activa (M01, AKINE-02.01).
 *
 * <p>Consume `GET /organizations/{orgId}/consultorios` —que <b>no</b> exige
 * `consultorio:manage`, porque es la misma lectura que necesita el selector de contexto— y
 * las dos mutaciones que si lo exigen: `PATCH .../{id}` y `POST .../{id}/deactivate`. El
 * `orgId` sale de {@link TenantContextStore}: la pantalla no guarda una copia.
 *
 * <p><b>Las sedes inactivas no se ocultan: se muestran como inactivas.</b> La baja es
 * logica y su historia sigue siendo relevante —turnos, sesiones y cobros historicos siguen
 * apuntando a esa sede—, asi que la fila conserva el motivo declarado y la fecha de la
 * baja. Filtrar los inactivos "para limpiar la tabla" tiraria justamente la informacion por
 * la que la baja es logica. El filtro de estado existe igual, visible y con `ACTIVO` por
 * defecto: el uso normal es el dia a dia, no la revision del historial.
 *
 * <p><b>La `version` viaja en cada edicion.</b> Si quedo vieja el backend responde
 * `409 concurrent-modification` y no se pisa nada: la pantalla relee la sede, actualiza la
 * base de comparacion y deja el panel abierto con lo que el usuario habia escrito, para que
 * pueda decidir con los datos actuales a la vista.
 *
 * <p><b>Semantica `PATCH`: omitido no es lo mismo que vacio.</b> Ver
 * {@link armarCambios}.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Cambiar de organizacion sin recargar dejaria en
 * pantalla las sedes de la anterior bajo la nueva, y un panel de baja a medio llenar
 * apuntando a un id de otro tenant es peor que uno vacio.
 *
 * <p><b>Las acciones van detras de `*akinePermiso`, que es UX y no seguridad.</b> Quien
 * llegue sin `consultorio:manage` ve la tabla completa y ningun boton; si igual arma el
 * `PATCH` con curl, el backend responde `403`. Ocultar no autoriza.
 */
@Component({
  selector: 'app-consultorios-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective],
  templateUrl: './consultorios-page.html',
  styleUrl: '../../organization.css',
})
export class ConsultoriosPage {
  private readonly organizaciones = inject(OrganizacionesService);
  private readonly consultorios = inject(ConsultoriosService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly sedesDelContexto = inject(SedesDelContexto);

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly zonas = zonasHorarias();
  protected readonly etiquetaDeZona = etiquetaDeZona;

  protected readonly estado = signal<EstadoListado>({ tipo: 'cargando' });
  protected readonly filtro = signal<FiltroEstado>('ACTIVO');
  protected readonly paginaActual = signal(0);

  /** Fila y operacion abiertas, o `null`. Solo una a la vez. */
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );

  /**
   * Sede tal como la devolvio el backend la ultima vez, para el panel abierto.
   *
   * <p>Es la <b>base de comparacion</b> del `PATCH`: sin ella no se puede distinguir un
   * campo que el usuario no toco de uno que vacio a proposito. Se reemplaza cuando la sede
   * se relee tras un conflicto de concurrencia, porque a partir de ahi lo que hay guardado
   * es otra cosa.
   */
  private readonly original = signal<ConsultorioResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaConsultorio | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  /** Datos de la sede. `slotMinutes` va como texto: el `input` siempre entrega texto. */
  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    name: ['', [Validators.required]],
    timezone: [''],
    slotMinutes: [''],
    legalName: [''],
    taxId: [''],
    addressLine: [''],
    phone: [''],
    contactEmail: ['', [Validators.email]],
  });

  /** El motivo de la baja es obligatorio: es lo que explica la decision seis meses despues. */
  protected readonly formularioBaja = this.formBuilder.nonNullable.group({
    reason: ['', [Validators.required]],
  });

  protected readonly sedesDeLaPagina = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? (estado.pagina.content ?? []) : [];
  });

  protected readonly totalPaginas = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? (estado.pagina.totalPages ?? 0) : 0;
  });

  protected readonly totalSedes = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? (estado.pagina.totalElements ?? 0) : 0;
  });

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' && estado.faltaContexto;
  });

  /**
   * `true` cuando el error abierto es el tope del plan.
   *
   * <p>La plantilla lo usa para ofrecer el enlace a la suscripcion: el mensaje dice que hay
   * que cambiar de plan y la pantalla tiene que dejar hacerlo, no obligar a buscarla.
   */
  protected readonly esTopeDelPlan = computed(() => this.causaAccion() === 'tope-del-plan');

  constructor() {
    effect(() => {
      // Dependencia explicita: cualquier cambio de contexto invalida todo lo que hay abierto.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarPanel();
        this.exito.set(null);
        this.paginaActual.set(0);
        this.filtro.set('ACTIVO');
        this.sedesDelContexto.asegurarCargadas();
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.organizaciones
      .listOrganizationConsultorios({
        orgId,
        estado: this.filtro(),
        page: this.paginaActual(),
        size: POR_PAGINA,
      })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorConsultorio(respuesta);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
          return;
        }
        this.estado.set({ tipo: 'listo', pagina: respuesta });
      });
  }

  protected cambiarFiltro(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'INACTIVO' || valor === 'TODOS' ? valor : ('ACTIVO' as const);
    this.cerrarPanel();
    this.filtro.set(elegido);
    // Volver a la primera pagina: la pagina 3 del filtro anterior puede no existir en el
    // nuevo, y el backend devolveria una pagina vacia que se lee como "no hay sedes".
    this.paginaActual.set(0);
    this.cargar();
  }

  protected irAPagina(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.cerrarPanel();
    this.paginaActual.set(numero);
    this.cargar();
  }

  /** `true` si la sede es la del contexto de trabajo activo. */
  protected esLaDelContexto(id: number | undefined): boolean {
    return id !== undefined && id === this.tenantContext.consultorioId();
  }

  protected panelAbierto(id: number | undefined, tipo: TipoAccion): boolean {
    const panel = this.panel();
    return panel !== null && panel.id === id && panel.tipo === tipo;
  }

  protected abrirPanel(sede: ConsultorioResponse, tipo: TipoAccion): void {
    const id = sede.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(sede);
      this.cargarFormulario(sede);
    }
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.original.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.intentos.set(0);
    this.formularioBaja.reset({ reason: '' });
  }

  protected mostrarErrorEdicion(campo: 'name' | 'contactEmail'): boolean {
    const control = this.formularioEdicion.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarErrorBaja(): boolean {
    const control = this.formularioBaja.controls.reason;
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * Envia solo lo que cambio.
   *
   * <p>El resultado sin cambios reales es un cuerpo con `version` y nada mas, que el
   * backend acepta sin tocar nada. No se corta antes a proposito: la sede pudo haber
   * cambiado en el servidor y un `PATCH` vacio es la forma barata de enterarse.
   */
  protected enviarEdicion(): void {
    const panel = this.panel();
    const orgId = this.tenantContext.organizationId();
    if (panel === null || orgId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      this.enfocar(this.formularioEdicion.controls.name.invalid ? '#editar-name' : '#editar-email');
      return;
    }

    const cambios = this.armarCambios();
    if (cambios === null) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.consultorios
      .updateConsultorio({
        orgId,
        consultorioId: panel.id,
        updateConsultorioRequest: cambios,
      })
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.exito.set('Los datos de la sede quedaron guardados.');
          // Las sedes alimentan selectores de otras pantallas: un nombre editado que quedara
          // cacheado seguiria mostrandose viejo hasta el proximo cambio de contexto.
          this.sedesDelContexto.invalidar();
          this.sedesDelContexto.asegurarCargadas();
          this.cargar();
        },
        error: (error: unknown) => this.fallarEdicion(error, orgId, panel.id),
      });
  }

  protected enviarBaja(): void {
    const panel = this.panel();
    const orgId = this.tenantContext.organizationId();
    if (panel === null || orgId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioBaja.invalid) {
      this.formularioBaja.markAllAsTouched();
      this.enfocar('#baja-reason');
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    const eraLaDelContexto = this.esLaDelContexto(panel.id);

    this.consultorios
      .deactivateConsultorio({
        orgId,
        consultorioId: panel.id,
        deactivateConsultorioRequest: {
          reason: this.formularioBaja.getRawValue().reason.trim(),
        },
      })
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.sedesDelContexto.invalidar();

          // Una sede inactiva no recibe operaciones nuevas. Si el usuario acaba de dar de
          // baja justamente la sede sobre la que esta parado, seguir en esta pantalla lo
          // dejaria con un contexto que ya no sirve y con cada accion siguiente fallando por
          // un motivo que no se explica solo. Se lo lleva a elegir otra, diciendole por que.
          if (eraLaDelContexto) {
            this.router
              .navigate([RUTA_SELECTOR_CONTEXTO], {
                queryParams: { [PARAM_MOTIVO]: MOTIVO_SEDE_INACTIVA },
              })
              .catch((error: unknown) => {
                // Una navegacion que falla en silencio deja al usuario en esta pantalla
                // creyendo que sigue teniendo un contexto util. Se le dice, aunque no haya
                // mucho mas que hacer desde aca.
                console.error('No se pudo abrir el selector de contexto tras la baja', error);
                this.errorAccion.set(
                  'La sede quedo dada de baja, pero no pudimos abrir la pantalla para elegir otra. ' +
                    'Entra a "Elegir contexto" desde el menu.',
                );
              });
            return;
          }

          this.exito.set('La sede quedo dada de baja. Sigue en el listado, con el motivo.');
          this.sedesDelContexto.asegurarCargadas();
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * Traduce el cuerpo del `PATCH` distinguiendo <b>omitido</b> de <b>cadena vacia</b>.
   *
   * <p>El contrato le da a las dos formas significados opuestos: un campo <b>ausente</b> no
   * se toca, y un campo con <b>cadena vacia</b> se borra. Un formulario que mande siempre
   * todos los campos no puede expresar "no lo toques", asi que borraria en cada guardado los
   * datos institucionales que otra persona hubiera cargado entre medio, sin que nadie pida
   * nada.
   *
   * <p>La regla es la comparacion contra {@link original}, que es lo que el backend
   * devolvio:
   *
   * <pre>
   * valor igual al original          -&gt; se omite      (el usuario no lo toco)
   * valor distinto y no vacio        -&gt; se manda      (lo cambio)
   * valor vaciado, original con dato -&gt; se manda ''   (lo borro a proposito)
   * valor vacio, original vacio      -&gt; se omite      (nunca hubo nada)
   * </pre>
   *
   * <p>`name`, `timezone` y `slotMinutes` <b>no</b> son borrables —el contrato no les da
   * significado a la cadena vacia—, asi que solo se mandan cuando cambian a un valor real.
   */
  private armarCambios(): UpdateConsultorioRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      // Sin `version` no hay edicion posible: mandarla en `0` pisaria el cambio de otro, que
      // es exactamente lo que el control de concurrencia optimista existe para impedir.
      this.errorAccion.set(
        'No pudimos leer la version de esta sede. Cerra el panel, recarga el listado y volve a intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdateConsultorioRequest = { version };

    const nombre = valores.name.trim();
    if (nombre !== (original.name ?? '')) {
      cambios.name = nombre;
    }

    if (valores.timezone !== '' && valores.timezone !== (original.timezone ?? '')) {
      cambios.timezone = valores.timezone;
    }

    const slot = Number(valores.slotMinutes);
    if (valores.slotMinutes !== '' && Number.isFinite(slot) && slot !== original.slotMinutes) {
      cambios.slotMinutes = slot;
    }

    for (const campo of CAMPOS_INSTITUCIONALES) {
      const actual = valores[campo].trim();
      const previo = original[campo] ?? '';
      if (actual !== previo) {
        // Aca `actual` puede ser '' a proposito: es la forma que el contrato define para
        // borrar el campo, y por eso se manda en vez de omitirse.
        cambios[campo] = actual;
      }
    }

    return cambios;
  }

  private cargarFormulario(sede: ConsultorioResponse): void {
    this.formularioEdicion.reset({
      name: sede.name ?? '',
      timezone: sede.timezone ?? '',
      slotMinutes: sede.slotMinutes === undefined ? '' : String(sede.slotMinutes),
      legalName: sede.legalName ?? '',
      taxId: sede.taxId ?? '',
      addressLine: sede.addressLine ?? '',
      phone: sede.phone ?? '',
      contactEmail: sede.contactEmail ?? '',
    });
  }

  /**
   * Falla de la edicion. El conflicto de concurrencia tiene tratamiento propio.
   *
   * <p>Ante `409 concurrent-modification` <b>no se pisa nada y no se cierra el panel</b>: se
   * relee la sede del servidor, se toma esa lectura como base de comparacion nueva —con su
   * `version` nueva— y se deja en pantalla lo que el usuario habia escrito. Asi puede ver el
   * mensaje, comparar con lo que quedo guardado y confirmar de nuevo si sigue queriendo su
   * cambio. Reintentar en silencio con la version nueva seria justamente pisar el cambio del
   * otro, que es lo que el `409` existe para evitar.
   */
  private fallarEdicion(error: unknown, orgId: number, consultorioId: number): void {
    const traducido = traducirErrorConsultorio(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);

    if (traducido.causa !== 'concurrencia') {
      return;
    }

    this.consultorios
      .getConsultorio({ orgId, consultorioId })
      .pipe(catchError(() => of(null)))
      .subscribe((sede) => {
        if (sede === null) {
          return;
        }
        this.original.set(sede);
        this.cargar();
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorConsultorio(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
