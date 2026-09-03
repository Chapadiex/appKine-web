import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CoberturaResponse } from '../../../../api/generated/model/cobertura-response';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreateCoberturaRequest } from '../../../../api/generated/model/create-cobertura-request';
import { FinanciadorResponse } from '../../../../api/generated/model/financiador-response';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PersonApi } from '../../services/person-api';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { PlanCoberturaResponse } from '../../../../api/generated/model/plan-cobertura-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateCoberturaRequest } from '../../../../api/generated/model/update-cobertura-request';
import { CoberturasApi, FiltroDeCoberturas } from '../../services/coberturas-api';
import { CausaPersona, hayQueRecargar, traducirErrorPersona } from '../../models/person-errors';
import { fechaEnPalabras, importeEnPalabras } from '../../models/etiquetas-de-ficha';
import { nombreCompleto } from '../../models/etiquetas-de-person';
import {
  coberturaEnUnaLinea,
  coberturaOperable,
  credencialEnPalabras,
  situacionEnPalabras,
  vigenciaEnPalabras,
} from '../../models/etiquetas-de-cobertura';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'baja';

/** En cual de los tres estados esta el historial. No es paginado: el backend devuelve un array. */
type EstadoDeCoberturas =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly coberturas: readonly CoberturaResponse[] }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/**
 * Las coberturas de un paciente (M08, RF-M08-001..005, AKINE-03.04).
 *
 * <p>Responde tres preguntas del mostrador que son distintas entre si: con que cobertura se atiende
 * hoy, que coberturas tuvo, y cual es la preferida.
 *
 * <h2>1. Cobertura del paciente NO es convenio del consultorio (regla maestra 6)</h2>
 *
 * <p>Es la confusion que esta pantalla tiene que evitar activamente, porque el nombre de un
 * financiador en una lista se lee como "aca le cubren esto". <b>Que el paciente tenga obra social
 * no implica que el centro tenga convenio con ese financiador</b> (RN-M08-004), y nada de lo que
 * la API devuelve aca afirma que la prestacion sea facturable. La pantalla lo dice explicitamente
 * en la seleccion del dia, que es donde la lectura equivocada tiene consecuencias.
 *
 * <h2>2. Las tres formas de "terminar" una cobertura no son la misma, y la pantalla las separa</h2>
 *
 * <ul>
 *   <li><b>Finalizar la vigencia</b> —poner `vigenciaHasta`— es "el paciente cambio de obra
 *       social". La cobertura queda ACTIVA y sigue explicando el pasado. Es el caso frecuente y por
 *       eso tiene su propio boton, en vez de estar escondido dentro de "editar".</li>
 *   <li><b>Dar de baja</b> es "esta cobertura nunca debio cargarse". Baja logica, con motivo.</li>
 *   <li><b>Que se venza sola</b> no es ninguna accion: se calcula al leer.</li>
 * </ul>
 *
 * <p>Fusionarlas en un unico "eliminar" haria que corregir un error de carga y registrar un cambio
 * de obra social produzcan el mismo dato, y despues no hay forma de distinguirlos.
 *
 * <h2>3. El plan no se puede cambiar, y cambiar de plan es otra cobertura</h2>
 *
 * <p>El formulario de edicion no tiene selector de plan, y no es un olvido: editarlo en el lugar
 * reescribiria con que cobertura se atendio al paciente el mes pasado. La pantalla lo dice donde
 * el operador lo va a buscar —en el panel de edicion— y ofrece el camino real: finalizar esta y
 * agregar la nueva.
 *
 * <h2>4. Marcar principal no desmarca a la otra, y el 409 trae el id de la que estorba</h2>
 *
 * <p>Un click que cambia dos coberturas deja una que despues nadie puede explicar. Cuando el
 * backend rechaza por solapamiento, la pantalla <b>resalta la fila</b> de la que ya es principal
 * en vez de mostrar un id en un cartel: el operador tiene que poder ver cual finalizar sin
 * buscarla.
 *
 * <h2>5. Una credencial vencida no invalida nada</h2>
 *
 * <p>Se informa y no se actua. Vencerla automaticamente daria de baja coberturas reales por un dato
 * que el mostrador copia a mano de un plastico.
 *
 * <h2>6. El caso que rompe la pantalla</h2>
 *
 * <p>Una persona que todavia no es paciente. El alta responde 409 `persona-sin-perfil-paciente` —es
 * RF-M07-010 sostenido desde M08— y el mensaje nombra la salida concreta: activarle el perfil desde
 * su ficha. Sin eso, el operador lee "no se pudo" sobre alguien que ve en pantalla.
 */
@Component({
  selector: 'app-coberturas-del-paciente-page',
  imports: [ReactiveFormsModule, RouterLink, ConfirmacionConMotivo, PermisoDirective],
  templateUrl: './coberturas-del-paciente-page.html',
  styleUrl: '../../person.css',
})
export class CoberturasDelPacientePage {
  private readonly api = inject(CoberturasApi);
  private readonly personas = inject(PersonApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly formBuilder = inject(FormBuilder);

  readonly personaId = input.required<string>();

  protected readonly permisoManage = PERMISO_PACIENTE_MANAGE;

  protected readonly nombreCompleto = nombreCompleto;
  protected readonly coberturaEnUnaLinea = coberturaEnUnaLinea;
  protected readonly vigenciaEnPalabras = vigenciaEnPalabras;
  protected readonly situacionEnPalabras = situacionEnPalabras;
  protected readonly credencialEnPalabras = credencialEnPalabras;
  protected readonly coberturaOperable = coberturaOperable;
  protected readonly importeEnPalabras = importeEnPalabras;
  protected readonly fechaEnPalabras = fechaEnPalabras;

  protected readonly estado = signal<EstadoDeCoberturas>({ tipo: 'cargando' });
  protected readonly persona = signal<PersonaResponse | null>(null);

  protected readonly filtro = signal<FiltroDeCoberturas>('TODAS');

  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );
  protected readonly altaAbierta = signal(false);

  /** Cobertura que el backend senalo en un 409, para resaltar su fila. */
  protected readonly senalada = signal<number | null>(null);

  protected readonly financiadores = signal<readonly FinanciadorResponse[]>([]);
  protected readonly planes = signal<readonly PlanCoberturaResponse[]>([]);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaPersona | null>(null);
  protected readonly exito = signal<string | null>(null);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  /** `true` cuando el rechazo se arregla activando el perfil, y la pantalla ofrece el enlace. */
  protected readonly faltaPerfil = computed(() => this.causaAccion() === 'sin-perfil-paciente');

  protected readonly coberturas = computed<readonly CoberturaResponse[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.coberturas : [];
  });

  protected readonly cargando = computed(() => this.estado().tipo === 'cargando');

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  /**
   * La cobertura marcada como preferida, si hay alguna vigente.
   *
   * <p>Se deriva del historial y no se pide aparte: `GET /seleccion` responde lo mismo con una
   * peticion mas, y el historial ya viene con `principal` y `vigente` calculados contra hoy. La
   * principal es determinista del lado del backend —lo hace cumplir un lock, no un desempate—, asi
   * que este `find` no esta eligiendo entre candidatas.
   */
  protected readonly principal = computed<CoberturaResponse | null>(
    () =>
      this.coberturas().find(
        (cobertura) =>
          cobertura.principal === true &&
          cobertura.vigente === true &&
          cobertura.estado !== 'INACTIVA',
      ) ?? null,
  );

  protected readonly vigentes = computed(() =>
    this.coberturas().filter(
      (cobertura) => cobertura.vigente === true && cobertura.estado !== 'INACTIVA',
    ),
  );

  protected readonly rutaFicha = computed(() => `/pacientes/${this.personaId()}` as const);

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    tipo: ['PARTICULAR', [Validators.required]],
    financiadorId: [''],
    planId: [''],
    numeroAfiliado: [''],
    credencialVigenciaHasta: [''],
    // La vigencia de inicio es obligatoria porque contra ella se congela el plan: sin fecha, el
    // backend no puede decidir si ese plan se podia elegir.
    vigenciaDesde: ['', [Validators.required]],
    vigenciaHasta: [''],
    principal: [false],
    observaciones: [''],
  });

  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    numeroAfiliado: [''],
    credencialVigenciaHasta: [''],
    vigenciaDesde: [''],
    vigenciaHasta: [''],
    observaciones: [''],
  });

  /** Cobertura tal como la devolvio el backend, para el panel abierto. Da la version. */
  private readonly original = signal<CoberturaResponse | null>(null);

  constructor() {
    effect(() => {
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargarFicha();
        this.cargar();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------------------

  private cargarFicha(): void {
    const id = this.identificador();
    if (id === null) {
      return;
    }
    this.personas.ver(id).subscribe({
      next: (ficha) => this.persona.set(ficha),
      error: () => this.persona.set(null),
    });
  }

  protected cargar(): void {
    const id = this.identificador();
    if (id === null) {
      this.estado.set({
        tipo: 'error',
        mensaje: 'La direccion no identifica a ninguna persona del padron.',
        faltaContexto: false,
      });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    // Sin `fecha`: el backend usa hoy, que es contra lo que el mostrador pregunta. Ofrecer un
    // selector de fecha aca convertiria la pantalla operativa en una consulta historica, y el
    // historico ya esta entero en la tabla.
    this.api.listar(id, this.filtro(), undefined).subscribe({
      next: (coberturas) => this.estado.set({ tipo: 'listo', coberturas }),
      error: (error: unknown) => {
        const traducido = traducirErrorPersona(error);
        this.estado.set({
          tipo: 'error',
          mensaje: traducido.mensaje,
          faltaContexto: traducido.causa === 'sin-contexto',
        });
      },
    });
  }

  protected cambiarFiltro(valor: string): void {
    this.filtro.set(valor === 'ACTIVA' || valor === 'INACTIVA' ? valor : 'TODAS');
    this.cargar();
  }

  // -------------------------------------------------------------------------------------
  // Alta
  // -------------------------------------------------------------------------------------

  protected abrirAlta(): void {
    this.cerrarPaneles();
    this.formularioAlta.reset({ tipo: 'PARTICULAR', principal: false });
    this.planes.set([]);
    this.altaAbierta.set(true);
    this.cargarFinanciadores();
  }

  /**
   * Los financiadores se piden al abrir el alta y no al entrar a la pantalla.
   *
   * <p>Consultar las coberturas de alguien es lo que se hace veinte veces por dia; cargar una
   * cobertura nueva, mucho menos. Pedir el catalogo en cada visita seria una peticion al pedo en el
   * caso frecuente.
   */
  private cargarFinanciadores(): void {
    this.api.financiadores().subscribe({
      next: (lista) => this.financiadores.set(lista),
      error: () => this.financiadores.set([]),
    });
  }

  /** Al elegir financiador se piden sus planes, evaluados contra `vigenciaDesde`. */
  protected elegirFinanciador(valor: string): void {
    this.formularioAlta.patchValue({ financiadorId: valor, planId: '' });
    this.planes.set([]);
    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) {
      return;
    }
    const desde = this.formularioAlta.getRawValue().vigenciaDesde;
    this.api.planes(id, desde === '' ? undefined : desde).subscribe({
      next: (lista) => this.planes.set(lista),
      error: () => this.planes.set([]),
    });
  }

  protected enviarAlta(): void {
    const id = this.identificador();
    if (id === null || this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const particular = valores.tipo === 'PARTICULAR';

    if (!particular && vacioEsUndefined(valores.planId) === undefined) {
      // Una FINANCIADA sin plan no tiene sentido y la base la rechaza. Se corta aca para nombrar
      // el campo, en vez de mandar un cuerpo que produce un 400 sobre un parametro.
      this.formularioAlta.markAllAsTouched();
      this.errorAccion.set('Elegi el plan de la cobertura financiada.');
      return;
    }

    const cuerpo: CreateCoberturaRequest = {
      tipo: valores.tipo as CreateCoberturaRequest['tipo'],
      // PARTICULAR no lleva plan ni credencial: es la ausencia de plan financiado, no una fila con
      // los campos en blanco. Mandarlos produciria el rechazo del CHECK de la base.
      planId: particular ? undefined : Number(valores.planId),
      numeroAfiliado: particular ? undefined : vacioEsUndefined(valores.numeroAfiliado),
      credencialVigenciaHasta: particular
        ? undefined
        : vacioEsUndefined(valores.credencialVigenciaHasta),
      vigenciaDesde: valores.vigenciaDesde,
      vigenciaHasta: vacioEsUndefined(valores.vigenciaHasta),
      principal: valores.principal ? true : undefined,
      observaciones: vacioEsUndefined(valores.observaciones),
    };

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.agregar(id, cuerpo).subscribe({
      next: (creada) => {
        this.enviando.set(false);
        this.altaAbierta.set(false);
        this.exito.set(`Se agrego la cobertura ${coberturaEnUnaLinea(creada)}.`);
        this.cargar();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Edicion y finalizacion de vigencia
  // -------------------------------------------------------------------------------------

  protected abrirEdicion(cobertura: CoberturaResponse): void {
    const id = cobertura.id;
    if (id === undefined) {
      return;
    }
    this.cerrarPaneles();
    this.original.set(cobertura);
    this.formularioEdicion.reset({
      numeroAfiliado: cobertura.numeroAfiliado ?? '',
      credencialVigenciaHasta: cobertura.credencialVigenciaHasta ?? '',
      vigenciaDesde: cobertura.vigenciaDesde ?? '',
      vigenciaHasta: cobertura.vigenciaHasta ?? '',
      observaciones: cobertura.observaciones ?? '',
    });
    this.panel.set({ id, tipo: 'editar' });
  }

  protected enviarEdicion(): void {
    const personaId = this.identificador();
    const original = this.original();
    if (personaId === null || original === null || original.id === undefined) {
      return;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cuerpo: UpdateCoberturaRequest = {
      numeroAfiliado: vacioEsUndefined(valores.numeroAfiliado),
      credencialVigenciaHasta: vacioEsUndefined(valores.credencialVigenciaHasta),
      vigenciaDesde: vacioEsUndefined(valores.vigenciaDesde),
      // Mandar esto ES finalizar la vigencia (RF-M08-003). No es dar de baja, y la pantalla lo
      // rotula asi en el formulario para que no se confundan.
      vigenciaHasta: vacioEsUndefined(valores.vigenciaHasta),
      observaciones: vacioEsUndefined(valores.observaciones),
      expectedVersion: original.version ?? 0,
    };

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.editar(personaId, original.id, cuerpo).subscribe({
      next: () => {
        this.enviando.set(false);
        this.panel.set(null);
        this.exito.set('Se guardaron los cambios de la cobertura.');
        this.cargar();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Principal
  // -------------------------------------------------------------------------------------

  protected cambiarPrincipal(cobertura: CoberturaResponse, principal: boolean): void {
    const personaId = this.identificador();
    const id = cobertura.id;
    if (personaId === null || id === undefined) {
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.marcarPrincipal(personaId, id, principal).subscribe({
      next: () => {
        this.enviando.set(false);
        this.exito.set(
          principal
            ? 'Quedo marcada como cobertura principal.'
            : 'Se quito la marca de principal. El paciente puede no tener ninguna preferida.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Baja
  // -------------------------------------------------------------------------------------

  protected abrirBaja(cobertura: CoberturaResponse): void {
    const id = cobertura.id;
    if (id === undefined) {
      return;
    }
    this.cerrarPaneles();
    this.original.set(cobertura);
    this.panel.set({ id, tipo: 'baja' });
  }

  protected confirmarBaja(motivo: string): void {
    const personaId = this.identificador();
    const abierto = this.panel();
    if (personaId === null || abierto === null) {
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.darDeBaja(personaId, abierto.id, motivo).subscribe({
      next: () => {
        this.enviando.set(false);
        this.panel.set(null);
        this.exito.set(
          'La cobertura quedo dada de baja. No se borro: sigue explicando con que se atendio al ' +
            'paciente antes, y aparece filtrando por "Todas".',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Paneles y apoyo
  // -------------------------------------------------------------------------------------

  protected cerrarPaneles(): void {
    this.panel.set(null);
    this.altaAbierta.set(false);
    this.original.set(null);
    this.limpiarAvisos();
  }

  protected esPanel(cobertura: CoberturaResponse, tipo: TipoAccion): boolean {
    const abierto = this.panel();
    return (
      abierto !== null &&
      cobertura.id !== undefined &&
      abierto.id === cobertura.id &&
      abierto.tipo === tipo
    );
  }

  /** `true` cuando el backend senalo esta fila en un 409. La plantilla la resalta. */
  protected estaSenalada(cobertura: CoberturaResponse): boolean {
    return cobertura.id !== undefined && this.senalada() === cobertura.id;
  }

  protected esFinanciada(): boolean {
    return this.formularioAlta.getRawValue().tipo === 'FINANCIADA';
  }

  protected mostrarErrorAlta(campo: string): boolean {
    const control = this.formularioAlta.get(campo);
    return control !== null && control.invalid && (control.touched || control.dirty);
  }

  private identificador(): number | null {
    const crudo = Number(this.personaId());
    return Number.isInteger(crudo) && crudo > 0 ? crudo : null;
  }

  private fallo(error: unknown): void {
    this.enviando.set(false);
    const traducido = traducirErrorPersona(error);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
    // El id que trae el 409 no se muestra: se usa para resaltar la fila. Un numero en un cartel no
    // le sirve a nadie que este mirando una tabla de coberturas.
    this.senalada.set(traducido.referenciaId);
  }

  private limpiarAvisos(): void {
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);
    this.senalada.set(null);
  }

  private reiniciar(): void {
    this.cerrarPaneles();
    this.persona.set(null);
    this.financiadores.set([]);
    this.planes.set([]);
    this.filtro.set('TODAS');
  }
}

/** `''` significa "no lo mandes", no "mandalo vacio". Es la diferencia entre omitir y borrar. */
function vacioEsUndefined(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}
