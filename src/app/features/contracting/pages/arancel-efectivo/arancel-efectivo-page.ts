import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ArancelEfectivoResponse } from '../../../../api/generated/model/arancel-efectivo-response';
import { CatalogoClinicoService } from '../../../../api/generated/api/catalogo-clinico.service';
import { CatalogoConceptoResponse } from '../../../../api/generated/model/catalogo-concepto-response';
import { ContractingApi } from '../../services/contracting-api';
import { ConveniosApi } from '../../services/convenios-api';
import { FinanciadorResponse } from '../../../../api/generated/model/financiador-response';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { PlanCoberturaResponse } from '../../../../api/generated/model/plan-cobertura-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { traducirErrorContracting } from '../../models/contracting-errors';
import {
  ExplicacionSinArancel,
  NOTA_PARTICULAR,
  enUnaLinea,
  explicarSinArancel,
  importeEnPalabras,
} from '../../models/etiquetas-de-contracting';
import { enPalabras, hoyLocal } from '../../models/vigencia-de-contracting';

/**
 * Consulta del arancel efectivo de una practica para una fecha (M16, RF-M16-006 y RF-M16-010).
 *
 * <p>Contesta una sola pregunta —<b>cuanto sale esto para este paciente ese dia</b>— y la contesta
 * con su derivacion: que convenio la produjo y con que dos vigencias.
 *
 * <h2>1. "No hay arancel" NO es un error, y esta pantalla existe sobre todo por eso</h2>
 *
 * <p>El endpoint responde <b>200</b> con `resuelto = false` y un motivo. El contrato lo justifica:
 * no encontrar convenio es el desenlace <b>mas frecuente</b> —la mayoria de los pacientes se
 * atienden como particulares— y un `404` obligaria a la pantalla a tratar el caso normal como una
 * excepcion.
 *
 * <p>Asi que aca no hay ningun cartel rojo ni ningun vacio para ese caso: hay una explicacion de
 * <b>por que</b> no hay precio y de que hacer ahora. Los dos motivos mandan a cosas distintas y
 * por eso hacen falta los dos: `SIN_CONVENIO_VIGENTE` manda a cobrar como particular (RN-M16-005)
 * y `SIN_ARANCEL_VIGENTE` dice que el convenio existe y lo que falta es el precio de <b>esa</b>
 * practica. Aplanarlos en un "no hay arancel" deja al usuario sin saber si tiene que cobrar o
 * cargar un dato.
 *
 * <p>Lo que si es un error de verdad —sin sede, sin permiso, servidor caido— se muestra aparte y
 * con su propio tratamiento. Mezclarlos seria volver a la confusion que el `200` evita.
 *
 * <h2>2. La fecha es la de la PRESTACION, no la de hoy</h2>
 *
 * <p>Consultar una fecha pasada devuelve el arancel que regia entonces, que es lo que hace que una
 * atencion retroactiva se cobre bien y que una liquidacion vieja se pueda explicar. Arranca en hoy
 * porque es el caso mas frecuente, pero el campo esta a la vista y la ayuda dice para que sirve
 * moverlo.
 *
 * <h2>3. El resultado es unico porque no puede haber dos candidatas</h2>
 *
 * <p>No porque haya una regla de prioridad que las desempate: dos convenios del mismo alcance no
 * se pueden solapar, y dos aranceles de la misma practica en el mismo convenio tampoco. Por eso la
 * pantalla puede mostrar <b>un</b> importe y explicarlo, en vez de una lista de candidatos.
 *
 * <h2>4. Esto NO es la cobertura del paciente</h2>
 *
 * <p>La pantalla pide financiador y plan a mano porque consulta el <b>convenio del consultorio</b>,
 * que es otra cosa que la Cobertura de una persona (regla maestra 6). Cuando exista la cobertura
 * del paciente, esta consulta va a poder precargarse desde ella; hoy no hay de donde sacarla, y
 * fingir que si la hay seria prometer un vinculo que no existe.
 */
@Component({
  selector: 'app-arancel-efectivo-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './arancel-efectivo-page.html',
  styleUrl: '../../contracting.css',
})
export class ArancelEfectivoPage {
  private readonly api = inject(ConveniosApi);
  private readonly catalogo = inject(ContractingApi);
  private readonly catalogoClinico = inject(CatalogoClinicoService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly enUnaLinea = enUnaLinea;
  protected readonly enPalabras = enPalabras;
  protected readonly importeEnPalabras = importeEnPalabras;
  protected readonly notaParticular = NOTA_PARTICULAR;

  protected readonly financiadores = signal<readonly FinanciadorResponse[]>([]);
  protected readonly planes = signal<readonly PlanCoberturaResponse[]>([]);
  protected readonly practicas = signal<readonly CatalogoConceptoResponse[]>([]);

  /**
   * Ofertas de la sede por las que se puede filtrar (B-3, RF-M16-008): activas y que admiten obra
   * social, que son las unicas que pueden tener arancel propio del convenio. No se filtran por la
   * practica: consultar con una oferta que no la declara devuelve el general, y eso es la verdad.
   */
  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);

  /**
   * La oferta con la que salio la ultima consulta, o `null` si fue sin oferta.
   *
   * <p>Se congela al enviar y no se lee del formulario: si el usuario cambia el selector despues,
   * el resultado en pantalla sigue siendo el de la consulta que se hizo.
   */
  private readonly ofertaConsultada = signal<number | null>(null);

  /** `true` mientras la consulta esta en vuelo. */
  protected readonly consultando = signal(false);

  /**
   * La respuesta, o `null` si todavia no se consulto.
   *
   * <p><b>Un resultado sin resolver ocupa este mismo signal</b>, y es deliberado: es una respuesta
   * valida del servidor, no la ausencia de una. Guardarlo en un campo de error lo trataria como
   * una falla.
   */
  protected readonly resultado = signal<ArancelEfectivoResponse | null>(null);

  /** Un error de verdad: sin sede, sin permiso, red caida. NO incluye "no hay arancel". */
  protected readonly error = signal<string | null>(null);

  /** `true` cuando falta contexto: la salida es elegir sede, no reintentar. */
  protected readonly faltaContexto = signal(false);

  protected readonly resuelto = computed(() => this.resultado()?.resuelto === true);

  /** Por que no hay precio, ya redactado. `null` cuando si lo hay o cuando no se consulto. */
  protected readonly sinArancel = computed<ExplicacionSinArancel | null>(() => {
    const respuesta = this.resultado();
    if (respuesta === null || respuesta.resuelto === true) {
      return null;
    }
    return explicarSinArancel(respuesta.motivo);
  });

  /**
   * De donde salio el importe: el arancel propio de la oferta o el general del convenio.
   *
   * <p>La distincion importa cuando se consulto CON oferta y volvio el general: no es un error,
   * es que esa oferta no tiene precio propio para la practica y rige el del convenio.
   */
  protected readonly origen = computed<string | null>(() => {
    const respuesta = this.resultado();
    if (respuesta === null || respuesta.resuelto !== true) {
      return null;
    }
    if (respuesta.ofertaId !== undefined && respuesta.ofertaId !== null) {
      return `Arancel propio de la oferta ${this.nombreDeOferta(respuesta.ofertaId)}.`;
    }
    const consultada = this.ofertaConsultada();
    if (consultada !== null) {
      return (
        `Arancel general del convenio: la oferta ${this.nombreDeOferta(consultada)} no tiene ` +
        'precio propio para esta practica, asi que rige el general.'
      );
    }
    return 'Arancel general del convenio: vale para cualquier oferta que no tenga precio propio.';
  });

  protected readonly formulario = this.formBuilder.nonNullable.group({
    financiadorId: ['', [Validators.required]],
    planId: ['', [Validators.required]],
    practicaId: ['', [Validators.required]],
    fecha: [hoyLocal(), [Validators.required]],
    // Vacio = sin oferta: resuelve el arancel general, que es lo que existia antes de B-3.
    ofertaId: [''],
  });

  protected readonly intentos = signal(0);

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargarFinanciadores();
        this.cargarPracticas();
        this.cargarOfertas();
      });
    });
  }

  protected mostrarError(campo: 'financiadorId' | 'planId' | 'practicaId'): boolean {
    const control = this.formulario.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * Carga los planes del financiador elegido y limpia el plan anterior.
   *
   * <p>Mismo motivo que en el alta de convenio: sin el reset queda seleccionado un plan de otro
   * financiador sobre un `select` repoblado, y la consulta se manda con una combinacion que no
   * existe. El sintoma seria "no hay convenio" sobre una combinacion que el usuario nunca pidio.
   */
  protected elegirFinanciador(valor: string): void {
    this.formulario.controls.planId.setValue('');
    this.planes.set([]);
    this.resultado.set(null);

    const id = Number(valor);
    if (valor === '' || !Number.isFinite(id)) {
      return;
    }

    this.catalogo
      .listarPlanes(id, { estado: 'ACTIVO' })
      .pipe(catchError(() => of(null)))
      .subscribe((planes) => this.planes.set(planes ?? []));
  }

  protected consultar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (this.consultando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);

    if (consultorioId === null) {
      this.error.set(
        'Los convenios son de una sede concreta, asi que hay que saber en cual estas trabajando. ' +
          'Eligi un consultorio y volve a entrar. Tu sesion sigue abierta.',
      );
      this.faltaContexto.set(true);
      return;
    }

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }

    const valores = this.formulario.getRawValue();

    this.consultando.set(true);
    this.error.set(null);
    this.faltaContexto.set(false);
    this.resultado.set(null);
    const ofertaId = valores.ofertaId === '' ? null : Number(valores.ofertaId);
    this.ofertaConsultada.set(ofertaId);

    this.api
      .resolverArancelEfectivo(consultorioId, {
        financiadorId: Number(valores.financiadorId),
        planId: Number(valores.planId),
        practicaId: Number(valores.practicaId),
        fecha: valores.fecha,
        ...(ofertaId === null ? {} : { ofertaId }),
      })
      .subscribe({
        next: (respuesta) => {
          this.consultando.set(false);
          // Tambien cuando `resuelto` es `false`: es una respuesta, no una falla.
          this.resultado.set(respuesta);
        },
        error: (error: unknown) => {
          const traducido = traducirErrorContracting(error, 'arancel');
          this.consultando.set(false);
          this.error.set(traducido.mensaje);
          this.faltaContexto.set(traducido.causa === 'sin-contexto');
        },
      });
  }

  /** Nombre de la practica elegida, para redactar el encabezado del resultado. */
  protected practicaElegida(): string {
    const id = Number(this.formulario.getRawValue().practicaId);
    const practica = this.practicas().find((candidata) => candidata.id === id);
    return practica === undefined ? 'la practica' : (practica.name ?? 'la practica');
  }

  private nombreDeOferta(id: number): string {
    const oferta = this.ofertas().find((candidata) => candidata.id === id);
    return oferta?.nombreComercial ?? `#${id}`;
  }

  /** Un fallo aca no rompe nada: el selector queda solo con "sin oferta" y se consulta el general. */
  private cargarOfertas(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.api
      .ofertasDeLaSede(consultorioId)
      .pipe(catchError(() => of([] as OfertaResponse[])))
      .subscribe((ofertas) =>
        this.ofertas.set(
          ofertas.filter(
            (oferta) => oferta.estado === 'ACTIVO' && oferta.admiteObraSocial === true,
          ),
        ),
      );
  }

  private cargarFinanciadores(): void {
    this.catalogo
      .listarFinanciadores({ estado: 'ACTIVO' })
      .pipe(catchError(() => of(null)))
      .subscribe((financiadores) => this.financiadores.set(financiadores ?? []));
  }

  /**
   * Practicas del catalogo clinico, con alcance `TODOS`.
   *
   * <p>Igual que en la grilla de aranceles: una practica puede ser global de la plataforma o
   * propia de la organizacion, y pedir un solo alcance dejaria la mitad del catalogo fuera del
   * selector sin ningun aviso.
   */
  private cargarPracticas(): void {
    this.catalogoClinico
      .searchCatalogo({ tipo: 'practicas', estado: 'ACTIVO', alcance: 'TODOS', size: 200 })
      .pipe(catchError(() => of(null)))
      .subscribe((pagina) => this.practicas.set(pagina?.content ?? []));
  }

  /** Un cambio de contexto invalida la respuesta: era de otra sede. */
  private reiniciar(): void {
    this.resultado.set(null);
    this.error.set(null);
    this.faltaContexto.set(false);
    this.consultando.set(false);
    this.intentos.set(0);
    this.financiadores.set([]);
    this.planes.set([]);
    this.practicas.set([]);
    this.ofertas.set([]);
    this.ofertaConsultada.set(null);
    this.formulario.reset({
      financiadorId: '',
      planId: '',
      practicaId: '',
      fecha: hoyLocal(),
      ofertaId: '',
    });
  }
}
