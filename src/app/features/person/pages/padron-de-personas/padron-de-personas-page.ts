import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { catchError, forkJoin, of } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreatePersonaRequest } from '../../../../api/generated/model/create-persona-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PersonaPageResponse } from '../../../../api/generated/model/persona-page-response';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdatePersonaRequest } from '../../../../api/generated/model/update-persona-request';
import { FiltroEstadoPersona, FiltroPerfil, PersonApi } from '../../services/person-api';
import { CausaPersona, hayQueRecargar, traducirErrorPersona } from '../../models/person-errors';
import {
  TIPOS_DE_DOCUMENTO,
  TipoDeDocumento,
  documentoEnUnaLinea,
  etiquetaDePerfil,
  etiquetaDeTipoDocumento,
  nombreCompleto,
  perfilEnPalabras,
  personaInactiva,
} from '../../models/etiquetas-de-person';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'activar-perfil';

const TAMANO_DE_PAGINA = 20;

/**
 * El padron de personas de la organizacion (M07, AKINE-03.01).
 *
 * <p>Es la pantalla que usa el mostrador todo el dia: buscar a alguien, darlo de alta si no
 * esta, corregirle un dato, y —cuando empieza una atencion— convertirlo en paciente.
 *
 * <h2>1. Persona y Paciente no son lo mismo, y la pantalla no deja olvidarlo</h2>
 *
 * <p>Es la decision que sostiene toda la fase (RN-M07-005). En pantalla se traduce en tres cosas
 * concretas, y ninguna es decorativa:
 *
 * <ul>
 *   <li><b>El alta no tiene ninguna casilla "es paciente".</b> No existe en el formulario porque
 *       no existe en el contrato: crear una persona nunca crea un perfil clinico (RF-M07-010).
 *       Convertirla en paciente es una accion aparte, con su propia confirmacion.</li>
 *   <li><b>La columna de perfil dice "Persona" y no "Sin perfil".</b> Alguien que viene a una
 *       clase de pilates es una ficha completa y correcta (RN-M07-006), no una a medio cargar. Un
 *       "pendiente" empujaria a activarle un perfil clinico para "terminarla".</li>
 *   <li><b>Activar el perfil avisa que no crea historia clinica.</b> La HC es M09, de un modulo
 *       que todavia no existe, y la pantalla no puede dar a entender lo contrario.</li>
 * </ul>
 *
 * <h2>2. La busqueda es la pantalla, no un filtro del listado</h2>
 *
 * <p>RN-M07-001 exige busqueda previa a la creacion. Por eso el buscador esta arriba de todo y el
 * boton de alta esta <b>al lado del buscador</b> y no en la barra de acciones: el orden visual es
 * el orden del procedimiento. Buscar primero, dar de alta despues.
 *
 * <p><b>Y eso es UX, no la regla.</b> La regla la hace cumplir el backend: un alta que coincide en
 * nombre completo o telefono se rechaza con 409 y la lista de candidatos. La pantalla no puede ser
 * la unica defensa —un alta por API entraria sin comprobacion— y por eso no intenta serlo.
 *
 * <h2>3. Los dos rechazos del alta se tratan distinto</h2>
 *
 * <p>Un documento repetido es un <b>invariante duro</b>: no hay nada que confirmar, y lo unico
 * util es llevar al operador a la ficha que ya existe. Un posible duplicado es una
 * <b>advertencia</b>: la pantalla trae las fichas candidatas —con nombre y documento, no ids
 * pelados— y ofrece las dos salidas reales, abrir una o confirmar que es otra persona.
 *
 * <p>Los candidatos se resuelven con una peticion por ficha. Es aceptable porque el caso es raro y
 * la lista es de dos o tres: mostrar "coincide con la persona #47" seria pedirle al operador que
 * memorice numeros.
 *
 * <h2>4. El contexto de trabajo invalida todo</h2>
 *
 * <p>Un cambio de organizacion o de consultorio cierra los paneles abiertos, limpia los filtros y
 * recarga. Un panel de edicion a medio llenar apuntando a una persona de otra organizacion es la
 * fuga de tenant que el aislamiento existe para evitar.
 *
 * <p><b>Leer el padron exige solo contexto de organizacion; mutarlo exige ademas una sede.</b> No
 * es un capricho: el permiso `paciente:manage` se evalua con la sede del contexto aunque la
 * persona pertenezca a la organizacion, porque sin sede el evaluador deja afuera justamente a
 * quien hace este trabajo. La pantalla no lo explica en la interfaz —seria ruido— pero el mensaje
 * de "sin contexto" pide las dos cosas.
 */
@Component({
  selector: 'app-padron-de-personas-page',
  imports: [ReactiveFormsModule, PermisoDirective, ConfirmacionConMotivo, Paginacion],
  templateUrl: './padron-de-personas-page.html',
  styleUrl: '../../person.css',
})
export class PadronDePersonasPage {
  private readonly api = inject(PersonApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly permisoManage = PERMISO_PACIENTE_MANAGE;
  protected readonly tiposDeDocumento = TIPOS_DE_DOCUMENTO;
  protected readonly documentoEnUnaLinea = documentoEnUnaLinea;
  protected readonly etiquetaDePerfil = etiquetaDePerfil;
  protected readonly etiquetaDeTipoDocumento = etiquetaDeTipoDocumento;
  protected readonly nombreCompleto = nombreCompleto;
  protected readonly perfilEnPalabras = perfilEnPalabras;
  protected readonly personaInactiva = personaInactiva;

  protected readonly estado = signal<EstadoDeListado<PersonaPageResponse>>({ tipo: 'cargando' });

  protected readonly personas = computed<readonly PersonaResponse[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? (actual.pagina.content ?? []) : [];
  });

  protected readonly totalPaginas = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? (actual.pagina.totalPages ?? 0) : 0;
  });

  protected readonly totalPersonas = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? (actual.pagina.totalElements ?? 0) : 0;
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  protected readonly cargando = computed(() => this.estado().tipo === 'cargando');

  protected readonly texto = signal('');
  protected readonly filtroEstado = signal<FiltroEstadoPersona>('ACTIVO');
  protected readonly filtroPerfil = signal<FiltroPerfil>('TODOS');
  protected readonly pagina = signal(0);

  /** Fila y operacion abiertas, o `null`. Solo una a la vez. */
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );

  protected readonly altaAbierta = signal(false);

  /** Persona tal como la devolvio el backend, para el panel abierto. Base de comparacion. */
  private readonly original = signal<PersonaResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaPersona | null>(null);
  protected readonly exito = signal<string | null>(null);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  /**
   * Fichas que coinciden con el alta rechazada.
   *
   * <p>Vacio salvo despues de un 409 `persona-posible-duplicado`. Son fichas completas y no ids:
   * ver el javadoc de la clase.
   */
  protected readonly candidatos = signal<readonly PersonaResponse[]>([]);

  /** Ficha que ya tiene el documento del alta rechazada, o `null`. */
  protected readonly duenioDelDocumento = signal<PersonaResponse | null>(null);

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    // Solo apellido y nombre son obligatorios: el documento es opcional a proposito, porque una
    // persona sin DNI es un caso real y exigirlo obligaria al mostrador a inventar uno.
    apellido: ['', [Validators.required]],
    nombre: ['', [Validators.required]],
    tipoDocumento: [''],
    numeroDocumento: [''],
    fechaNacimiento: [''],
    email: [''],
    telefono: [''],
    notas: [''],
  });

  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    apellido: [''],
    nombre: [''],
    tipoDocumento: [''],
    numeroDocumento: [''],
    fechaNacimiento: [''],
    email: [''],
    telefono: [''],
    notas: [''],
  });

  constructor() {
    effect(() => {
      // Dependencia explicita del contexto: cambiar de organizacion o de sede invalida todo lo
      // que hay abierto y todo lo que hay listado.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargar();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Busqueda
  // -------------------------------------------------------------------------------------

  protected buscar(texto: string): void {
    this.texto.set(texto);
    this.pagina.set(0);
    this.cargar();
  }

  protected cambiarEstado(valor: string): void {
    this.filtroEstado.set(valor as FiltroEstadoPersona);
    this.pagina.set(0);
    this.cargar();
  }

  protected cambiarPerfil(valor: string): void {
    this.filtroPerfil.set(valor as FiltroPerfil);
    this.pagina.set(0);
    this.cargar();
  }

  protected irAPagina(numero: number): void {
    this.pagina.set(numero);
    this.cargar();
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });
    this.api
      .buscar({
        texto: this.texto(),
        estado: this.filtroEstado(),
        perfil: this.filtroPerfil(),
        pagina: this.pagina(),
        tamano: TAMANO_DE_PAGINA,
      })
      .subscribe({
        next: (pagina) => this.estado.set({ tipo: 'listo', pagina }),
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

  // -------------------------------------------------------------------------------------
  // Alta
  // -------------------------------------------------------------------------------------

  protected abrirAlta(): void {
    this.cerrarPaneles();
    this.formularioAlta.reset();
    this.altaAbierta.set(true);
  }

  protected cerrarAlta(): void {
    this.altaAbierta.set(false);
    this.limpiarAvisos();
  }

  /**
   * Envia el alta.
   *
   * <p>`confirmando` en `true` es el reenvio despues de que el operador mirara los candidatos y
   * declarara que es otra persona. Es la traduccion por interfaz de "hice la busqueda previa".
   */
  protected enviarAlta(confirmando = false): void {
    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const cuerpo: CreatePersonaRequest = {
      apellido: valores.apellido.trim(),
      nombre: valores.nombre.trim(),
      // Tipo y numero viajan juntos o no viajan: el backend rechaza el par incompleto, y
      // mandarlo a medias seria un 400 que el operador no puede interpretar.
      tipoDocumento: this.tipoDocumentoDe(
        valores.tipoDocumento,
        valores.numeroDocumento,
      ) as CreatePersonaRequest['tipoDocumento'],
      numeroDocumento: vacioEsUndefined(valores.numeroDocumento),
      fechaNacimiento: vacioEsUndefined(valores.fechaNacimiento),
      email: vacioEsUndefined(valores.email),
      telefono: vacioEsUndefined(valores.telefono),
      notas: vacioEsUndefined(valores.notas),
      confirmaPosibleDuplicado: confirmando ? true : undefined,
    };

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.crear(cuerpo).subscribe({
      next: (creada) => {
        this.enviando.set(false);
        this.altaAbierta.set(false);
        this.exito.set(
          `${nombreCompleto(creada)} quedo registrada. Todavia no es paciente: si empieza una ` +
            'atencion clinica, activale el perfil desde su fila.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Edicion
  // -------------------------------------------------------------------------------------

  protected abrirEdicion(persona: PersonaResponse): void {
    const id = persona.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPaneles();
    this.original.set(persona);
    this.formularioEdicion.reset({
      apellido: persona.apellido,
      nombre: persona.nombre,
      tipoDocumento: persona.tipoDocumento ?? '',
      numeroDocumento: persona.numeroDocumento ?? '',
      fechaNacimiento: persona.fechaNacimiento ?? '',
      email: persona.email ?? '',
      telefono: persona.telefono ?? '',
      notas: persona.notas ?? '',
    });
    this.panel.set({ id, tipo: 'editar' });
  }

  protected enviarEdicion(): void {
    const original = this.original();
    // El id viene opcional del generado -asi los declara el contrato- y sin el no hay a quien
    // editar. Mismo tratamiento que en ofertas: se corta, no se fuerza con un '!'.
    if (original === null || original.id === undefined) {
      return;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cuerpo: UpdatePersonaRequest = {
      apellido: valores.apellido.trim(),
      nombre: valores.nombre.trim(),
      tipoDocumento: this.tipoDocumentoDe(
        valores.tipoDocumento,
        valores.numeroDocumento,
      ) as UpdatePersonaRequest['tipoDocumento'],
      numeroDocumento: vacioEsUndefined(valores.numeroDocumento),
      fechaNacimiento: vacioEsUndefined(valores.fechaNacimiento),
      email: vacioEsUndefined(valores.email),
      telefono: vacioEsUndefined(valores.telefono),
      notas: vacioEsUndefined(valores.notas),
      // La version es obligatoria en el contrato y opcional en el generado: sin ella el backend
      // no puede detectar la edicion concurrente. Ausente se manda 0, que produce el 409 en vez
      // de pisar el cambio ajeno en silencio.
      expectedVersion: original.version ?? 0,
    };

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.editar(original.id, cuerpo).subscribe({
      next: (actualizada) => {
        this.enviando.set(false);
        this.cerrarPaneles();
        this.exito.set(`Se guardaron los cambios de ${nombreCompleto(actualizada)}.`);
        this.cargar();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Perfil clinico
  // -------------------------------------------------------------------------------------

  protected abrirActivacion(persona: PersonaResponse): void {
    const id = persona.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPaneles();
    this.original.set(persona);
    this.panel.set({ id, tipo: 'activar-perfil' });
  }

  /**
   * Activa el perfil clinico.
   *
   * <p>Es idempotente del lado del servidor: activar dos veces devuelve el perfil que ya existia,
   * con 200. Por eso la pantalla no tiene ninguna rama para "ya era paciente" — no hay error que
   * mostrar, y el mensaje de exito sirve para los dos casos.
   */
  protected confirmarActivacion(motivo: string): void {
    const persona = this.original();
    if (persona === null || persona.id === undefined) {
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.activarPerfil(persona.id, motivo.trim()).subscribe({
      next: (actualizada) => {
        this.enviando.set(false);
        this.cerrarPaneles();
        this.exito.set(
          `${nombreCompleto(actualizada)} ya es paciente. Esto no le crea historia clinica: eso ` +
            'se maneja en el modulo clinico.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Paneles y avisos
  // -------------------------------------------------------------------------------------

  protected cerrarPaneles(): void {
    this.panel.set(null);
    this.altaAbierta.set(false);
    this.original.set(null);
    this.limpiarAvisos();
  }

  /** `true` cuando el campo del alta ya fue tocado y sigue invalido. */
  protected mostrarErrorAlta(campo: string): boolean {
    const control = this.formularioAlta.get(campo);
    return control !== null && control.invalid && (control.touched || control.dirty);
  }

  protected esPanel(persona: PersonaResponse, tipo: TipoAccion): boolean {
    const abierto = this.panel();
    return (
      abierto !== null &&
      persona.id !== undefined &&
      abierto.id === persona.id &&
      abierto.tipo === tipo
    );
  }

  /** Cierra el aviso de duplicados y deja el formulario de alta como estaba, para corregirlo. */
  protected descartarCandidatos(): void {
    this.candidatos.set([]);
    this.duenioDelDocumento.set(null);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
  }

  private limpiarAvisos(): void {
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);
    this.candidatos.set([]);
    this.duenioDelDocumento.set(null);
  }

  /**
   * Traduce el error y, cuando el rechazo trae fichas involucradas, las resuelve.
   *
   * <p>Las fichas se piden de a una y los fallos se descartan: si una no resuelve —porque la
   * dieron de baja entre medio—, el aviso se muestra igual con las que si. Perder el aviso entero
   * por una ficha que no carga seria peor que mostrarlo incompleto.
   */
  private fallo(error: unknown): void {
    this.enviando.set(false);
    const traducido = traducirErrorPersona(error);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);

    if (traducido.causa === 'posible-duplicado' && traducido.candidatos.length > 0) {
      forkJoin(
        traducido.candidatos.map((id) => this.api.ver(id).pipe(catchError(() => of(null)))),
      ).subscribe((fichas) => {
        this.candidatos.set(fichas.filter((ficha): ficha is PersonaResponse => ficha !== null));
      });
      return;
    }

    if (traducido.causa === 'documento-en-uso' && traducido.personaExistenteId !== null) {
      this.api
        .ver(traducido.personaExistenteId)
        .pipe(catchError(() => of(null)))
        .subscribe((ficha) => this.duenioDelDocumento.set(ficha));
    }
  }

  private reiniciar(): void {
    this.cerrarPaneles();
    this.texto.set('');
    this.filtroEstado.set('ACTIVO');
    this.filtroPerfil.set('TODOS');
    this.pagina.set(0);
  }

  /**
   * El tipo de documento solo viaja si viene con un numero.
   *
   * <p>El par es indivisible —lo verifica el backend y tambien la base— y mandar un tipo sin
   * numero produciria un 400 que en pantalla se lee como un error inexplicable.
   *
   * <p>Devuelve {@link TipoDeDocumento} y no el enum del generado, aunque los tres conjuntos de
   * valores sean identicos: el generador emite <b>un enum por DTO</b> —uno para el alta y otro
   * para la edicion— y son tipos distintos aunque digan lo mismo. Devolver el de uno obligaria a
   * castear en el otro, asi que el cast se hace una sola vez, en cada armado de cuerpo, con el
   * tipo que ese cuerpo declara.
   */
  private tipoDocumentoDe(tipo: string, numero: string): TipoDeDocumento | undefined {
    if (tipo === '' || numero.trim() === '') {
      return undefined;
    }
    return tipo as TipoDeDocumento;
  }
}

/** `''` significa "no lo mandes", no "mandalo vacio". Es la diferencia entre omitir y borrar. */
function vacioEsUndefined(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}
