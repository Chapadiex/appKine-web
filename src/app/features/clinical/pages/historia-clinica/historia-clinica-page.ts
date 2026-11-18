import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { cabeceraDePersona } from '../../../../core/services/cabecera-de-persona';
import { CabeceraDeFicha } from '../../../../shared/components/cabecera-de-ficha/cabecera-de-ficha';
import { Observable, Subscription } from 'rxjs';

import {
  AntecedenteResponse,
  AntecedenteResponseTipoEnum,
} from '../../../../api/generated/model/antecedente-response';
import { EventoClinicoResponse } from '../../../../api/generated/model/evento-clinico-response';
import { RegistrarAntecedenteRequest } from '../../../../api/generated/model/registrar-antecedente-request';
import { HistoriaClinicaResponse } from '../../../../api/generated/model/historia-clinica-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CasosDeLaHistoria } from '../../casos/components/casos-de-la-historia';
import { PedidoDeMotivo } from '../../components/pedido-de-motivo';
import {
  FichaDeIngreso,
  TildeDeEnfermedad,
} from '../../components/ficha-de-ingreso/ficha-de-ingreso';
import {
  TIPOS_DE_ANTECEDENTE,
  etiquetaDeOrigen,
  fechaYHora,
  rotulo,
} from '../../models/etiquetas-de-historia';
import { ErrorHistoria, errorDeCausa, traducirErrorHistoria } from '../../models/historia-errors';
import { HistoriaClinicaApi } from '../../services/historia-clinica-api';
import { VisitaClinica } from '../../services/visita-clinica';
import { DetalleDeEntrada } from './components/detalle-de-entrada';
import { NuevaEntrada } from './components/nueva-entrada';
import { NuevoAdjunto } from './components/nuevo-adjunto';
import { TimelineClinico, claveDe } from './components/timeline-clinico';
import { VisorDeAdjunto } from './components/visor-de-adjunto';
import { SesionesDeLaHistoria } from './components/sesiones-de-la-historia';
import { RouterLink } from '@angular/router';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Icono } from '../../../../shared/components/icono/icono';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { PERMISO_HC_DECLARAR, PERMISO_HC_WRITE } from '../../../../core/models/permisos';
import { Chips, OpcionChip } from '../../../../shared/components/chips/chips';
import { NumeroConPasos } from '../../../../shared/components/numero-con-pasos/numero-con-pasos';
import { TextoOpcional } from '../../../../shared/components/texto-opcional/texto-opcional';
import { OPCIONES_DE_ZONA, zonaEnChips } from '../../models/zonas-del-cuerpo';
import {
  DatosDeclaradosApi,
  DatosDeclaradosResponse,
  FichaDeIngresoRequest,
  FichaDeIngresoResponse,
  OcupacionResponse,
} from '../datos-declarados/datos-declarados.api';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'requiere-justificacion' }
  | { readonly tipo: 'sin-historia' }
  | { readonly tipo: 'lista'; readonly historia: HistoriaClinicaResponse }
  | { readonly tipo: 'error'; readonly error: ErrorHistoria };

/**
 * La Historia Clinica de una persona: cabecera, casos, timeline y detalle (D-a, D-b,
 * RF-M09-001/003, RF-M25).
 *
 * <h2>El motivo de acceso es de esta visita</h2>
 *
 * <p>DP-03: quien no tiene relacion asistencial con la persona declara un motivo, y cada lectura
 * se audita con el. La pantalla pide primero sin motivo —el backend sabe si hace falta, el cliente
 * no— y solo ante el 403 con `requiereJustificacion` muestra el formulario. El motivo vive en
 * {@link VisitaClinica}, que comparten la historia, sus casos y sus planes: ir y volver entre ellos
 * es la misma visita. Recargar, cambiar de contexto o volver a entrar desde la ficha lo vuelve a
 * pedir. Recordarlo entre visitas convertiria el control en un formalismo.
 *
 * <h2>Cambiar de contexto vacia la pantalla</h2>
 *
 * <p>La historia es de la organizacion (DP-03). Si el usuario cambia de organizacion o de sede,
 * lo que habia en pantalla es de otro tenant o se leyo con otra relacion asistencial: se descarta
 * todo, motivo incluido, y se vuelve a pedir.
 */
@Component({
  selector: 'app-historia-clinica-page',
  imports: [
    Chips,
    NumeroConPasos,
    TextoOpcional,
    Alerta,
    CabeceraDeFicha,
    Ayuda,
    TimelineClinico,
    DetalleDeEntrada,
    VisorDeAdjunto,
    NuevaEntrada,
    NuevoAdjunto,
    PedidoDeMotivo,
    CasosDeLaHistoria,
    SesionesDeLaHistoria,
    RouterLink,
    Icono,
    FichaDeIngreso,
  ],
  templateUrl: './historia-clinica-page.html',
  styleUrl: './historia-clinica.css',
})
export class HistoriaClinicaPage {
  private readonly api = inject(HistoriaClinicaApi);
  private readonly avisos = inject(AvisosStore);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly visita = inject(VisitaClinica);
  private readonly declaradosApi = inject(DatosDeclaradosApi);
  private readonly permisos = inject(PermissionsStore);

  protected readonly fechaYHora = fechaYHora;
  protected readonly etiquetaDeOrigen = etiquetaDeOrigen;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly justificacion = this.visita.motivo;
  protected readonly abriendo = signal(false);
  protected readonly errorAlAbrir = signal<ErrorHistoria | null>(null);

  protected readonly seleccion = signal<EventoClinicoResponse | null>(null);
  protected readonly recargas = signal(0);

  /** La ficha administrativa de la misma persona (D-e): el camino de ida y vuelta es uno solo. */
  protected readonly rutaFicha = this.visita.rutaFicha;

  /** El id de la persona como texto, para las pestañas de la cabecera. */
  protected readonly personaIdTexto = computed(() => String(this.visita.personaId() ?? ''));

  protected readonly cabecera = cabeceraDePersona(() => ({
    personaId: this.personaIdTexto(),
    persona: null,
    actual: 'historia',
    nombreAlternativo: this.historia()?.personaNombreCompleto || 'Historia clínica',
    documentoAlternativo: this.historia()?.personaDocumento || null,
    esPaciente: true,
  }));

  protected readonly historia = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'lista' ? estado.historia : null;
  });

  protected readonly error = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.error : null;
  });

  protected readonly claveElegida = computed(() => {
    const evento = this.seleccion();
    return evento === null ? null : claveDe(evento);
  });

  /** El antecedente elegido, si sigue vigente: la cabecera solo trae los vigentes. */
  protected readonly antecedenteElegido = computed<AntecedenteResponse | null>(() => {
    const evento = this.seleccion();
    if (evento?.origen !== 'ANTECEDENTE_CLINICO') {
      return null;
    }
    return this.historia()?.antecedentes?.find((a) => a.id === evento.referencia) ?? null;
  });

  /** DP-47: cuantos datos declarados esperan revision. */
  protected readonly declaradosSinRevisar = computed(
    () => this.historia()?.declaradosSinRevisar ?? 0,
  );

  /** Los declarados pendientes, para revisarlos desde aca. Se piden solo si hay alguno. */
  protected readonly declarados = signal<DatosDeclaradosResponse | null>(null);
  protected readonly revisando = signal<number | null>(null);

  /** Ficha de ingreso de la historia: se pide aparte (GET 200/204). */
  protected readonly ficha = signal<FichaDeIngresoResponse | null>(null);
  protected readonly ocupaciones = signal<readonly OcupacionResponse[]>([]);
  protected readonly guardandoFicha = signal(false);
  private readonly fichaDeIngreso = viewChild(FichaDeIngreso);

  /** Detalle de una cirugia en el alta de antecedente. */
  protected readonly zonaNueva = signal('');
  protected readonly anioNuevo = signal('');
  protected readonly lugarNuevo = signal('');
  protected readonly anioMaximo = new Date().getFullYear();

  /** Enfermedades de la lista vigentes en la historia (de cualquier origen). */
  protected readonly enfermedadesTildadas = computed(
    () =>
      new Set(
        (this.historia()?.antecedentes ?? []).flatMap((a) =>
          a.codigo ? [a.codigo as string] : [],
        ),
      ),
  );
  protected readonly adjuntoDeclaradoAbierto = signal<number | null>(null);

  protected readonly antecedentesPendientes = computed(
    () => this.declarados()?.antecedentes?.filter((a) => !a.revisadoEn) ?? [],
  );
  protected readonly adjuntosPendientes = computed(
    () => this.declarados()?.adjuntos?.filter((a) => !a.revisadoEn) ?? [],
  );

  /** DP-47: la marca de cada adjunto declarado, revisado o no, para el timeline y el detalle. */
  protected readonly marcasDeAdjuntos = computed(() => {
    const marcas = new Map<number, string>();
    for (const adjunto of this.declarados()?.adjuntos ?? []) {
      const marca = this.marcaDeclarado(adjunto);
      if (adjunto.id !== undefined && marca !== null) {
        marcas.set(adjunto.id, marca);
      }
    }
    return marcas;
  });

  protected puedeRevisar(): boolean {
    return this.permisos.tiene(PERMISO_HC_WRITE);
  }

  /** "Declarado · sin revisar" o "Declarado · revisado por X"; `null` si lo cargo un profesional. */
  protected marcaDeclarado(campos: {
    origen?: string;
    revisadoEn?: string | null;
    revisadoPorNombre?: string | null;
  }): string | null {
    if (campos.origen !== 'DECLARADO') {
      return null;
    }
    if (!campos.revisadoEn) {
      return 'Declarado · sin revisar';
    }
    return campos.revisadoPorNombre
      ? `Declarado · revisado por ${campos.revisadoPorNombre}`
      : 'Declarado · revisado';
  }

  protected revisarAntecedente(antecedenteId: number): void {
    this.revisar(
      antecedenteId,
      this.declaradosApi.revisarAntecedente(
        this.idDePersona(),
        antecedenteId,
        this.justificacion(),
      ),
    );
  }

  protected revisarAdjunto(adjuntoId: number): void {
    const historiaClinicaId = this.historia()?.id;
    if (historiaClinicaId === undefined) {
      return;
    }
    this.revisar(
      adjuntoId,
      this.declaradosApi.revisarAdjunto(historiaClinicaId, adjuntoId, this.justificacion()),
    );
  }

  protected alternarAdjuntoDeclarado(adjuntoId: number): void {
    this.adjuntoDeclaradoAbierto.update((actual) => (actual === adjuntoId ? null : adjuntoId));
  }

  private revisar(id: number, pedido: Observable<unknown>): void {
    if (this.revisando() !== null) {
      return;
    }
    this.revisando.set(id);
    pedido.subscribe({
      next: () => {
        this.revisando.set(null);
        this.avisos.exito('Marcado como revisado');
        this.cargar();
      },
      error: (error: unknown) => {
        this.revisando.set(null);
        this.avisos.error('No pudimos marcarlo como revisado', {
          descripcion: traducirErrorHistoria(error).mensaje,
        });
      },
    });
  }

  private cargarFicha(): void {
    this.ficha.set(null);
    this.releerFicha();
    if (this.ocupaciones().length === 0 && this.puedeRevisar()) {
      this.declaradosApi.ocupaciones().subscribe({
        next: (lista) => this.ocupaciones.set(lista),
        error: () => this.ocupaciones.set([]),
      });
    }
  }

  /** Relee la ficha sin pasar por null: el componente no pierde lo que se esta escribiendo. */
  private releerFicha(): void {
    this.declaradosApi.verFicha(this.idDePersona(), this.justificacion()).subscribe({
      next: (ficha) => this.ficha.set(ficha ?? null),
      error: () => undefined,
    });
  }

  protected guardarFicha(ficha: FichaDeIngresoRequest): void {
    this.guardandoFicha.set(true);
    this.declaradosApi.registrarFicha(this.idDePersona(), ficha, this.justificacion()).subscribe({
      next: (guardada) => {
        this.guardandoFicha.set(false);
        this.ficha.set(guardada);
        this.refrescar();
      },
      error: (error: unknown) => {
        this.fichaDeIngreso()?.fallo();
        this.guardandoFicha.set(false);
        this.avisos.error('No pudimos guardar la ficha', {
          descripcion: traducirErrorHistoria(error).mensaje,
        });
        if (error instanceof AkineHttpError && error.status === 409) {
          this.releerFicha();
        }
      },
    });
  }

  protected revisarFicha(): void {
    this.declaradosApi.revisarFicha(this.idDePersona(), this.justificacion()).subscribe({
      next: (revisada) => {
        this.ficha.set(revisada);
        this.avisos.exito('Ficha revisada');
        this.refrescar();
      },
      error: (error: unknown) =>
        this.avisos.error('No pudimos marcarla como revisada', {
          descripcion: traducirErrorHistoria(error).mensaje,
        }),
    });
  }

  protected agregarOcupacion(nombre: string): void {
    this.declaradosApi.agregarOcupacion(nombre).subscribe({
      next: (ocupacion) => {
        this.ocupaciones.update((lista) =>
          lista.some((o) => o.id === ocupacion.id)
            ? lista
            : [...lista, ocupacion].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
        );
        this.fichaDeIngreso()?.guardarOcupacion(ocupacion.id);
      },
      error: (error: unknown) =>
        this.avisos.error('No pudimos agregar la ocupación', {
          descripcion: traducirErrorHistoria(error).mensaje,
        }),
    });
  }

  /** El profesional tilda: queda registrado. Destildar no se hace aca (la casilla queda fija). */
  protected tildarEnfermedad(tilde: TildeDeEnfermedad): void {
    if (!tilde.marcado) {
      return;
    }
    this.api
      .registrarAntecedente(
        this.idDePersona(),
        'MEDICO' as RegistrarAntecedenteRequest['tipo'],
        tilde.etiqueta,
        this.justificacion(),
        { codigo: tilde.codigo as RegistrarAntecedenteRequest['codigo'] },
      )
      .subscribe({
        next: () => this.refrescar(),
        error: (error: unknown) => {
          this.avisos.error('No pudimos guardar el tilde', {
            descripcion: traducirErrorHistoria(error).mensaje,
          });
          this.refrescar();
        },
      });
  }

  /** "Rodilla derecha · 2019 · Hospital Privado", o vacio si no tiene detalle. */
  protected detalleDe(antecedente: { zona?: string; anio?: number; lugar?: string }): string {
    return [antecedente.zona, antecedente.anio, antecedente.lugar]
      .filter((parte) => parte !== undefined && parte !== null && parte !== '')
      .join(' · ');
  }

  private cargarDeclarados(historia: HistoriaClinicaResponse): void {
    this.declarados.set(null);
    // Se pide siempre que se pueda (marcas de lo ya revisado incluidas), y solo con hc:declarar:
    // sin el permiso el backend registra el rechazo en cada visita.
    if (historia.id === undefined || !this.permisos.tiene(PERMISO_HC_DECLARAR)) {
      return;
    }
    this.declaradosApi.ver(this.idDePersona(), this.justificacion()).subscribe({
      next: (datos) => this.declarados.set(datos),
      // Sin la lista el aviso sigue; revisar queda para cada dato en su lugar.
      error: () => this.declarados.set(null),
    });
  }

  private pedido: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pedido?.unsubscribe());

    // Otra persona, otro contexto o un motivo recien declarado: se relee todo desde cero.
    effect(() => {
      this.visita.personaId();
      this.visita.motivo();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.seleccion.set(null);
        this.cargar();
      });
    });
  }

  protected rotuloDeAntecedente(antecedente: AntecedenteResponse): string {
    return rotulo(TIPOS_DE_ANTECEDENTE, antecedente.tipo);
  }

  protected reintentar(): void {
    this.cargar();
  }

  /** PUT idempotente: si otro la abrio en el medio, devuelve esa y no duplica nada. */
  protected abrirHistoria(): void {
    this.abriendo.set(true);
    this.errorAlAbrir.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api.abrir(this.idDePersona(), this.justificacion()).subscribe({
      next: (historia) => {
        this.abriendo.set(false);
        this.estado.set({ tipo: 'lista', historia });
        this.avisos.exito('Historia clínica abierta');
      },
      error: (error: unknown) => {
        this.abriendo.set(false);
        const traducido = traducirErrorHistoria(error);
        if (traducido.causa === 'requiere-justificacion') {
          this.estado.set({ tipo: 'requiere-justificacion' });
          return;
        }
        this.errorAlAbrir.set(traducido);
      },
    });
  }

  protected elegir(evento: EventoClinicoResponse): void {
    this.seleccion.set(evento);
  }

  protected cerrarDetalle(): void {
    this.seleccion.set(null);
  }

  /** Algo nuevo en la historia: el timeline se relee desde el principio para mostrarlo. */
  protected huboCambios(): void {
    this.recargas.update((n) => n + 1);
  }

  // ===========================================================================
  // Carga del profesional sin atencion: resumen y antecedentes (hc:write)
  // ===========================================================================

  protected readonly tiposDeAntecedente = Object.entries(TIPOS_DE_ANTECEDENTE) as [
    AntecedenteResponseTipoEnum,
    string,
  ][];

  protected readonly editandoResumen = signal(false);
  protected readonly resumenEscrito = signal('');
  protected readonly guardandoResumen = signal(false);
  protected readonly errorResumen = signal<string | null>(null);

  protected readonly agregandoAntecedente = signal(false);
  protected readonly tipoNuevo = signal<AntecedenteResponseTipoEnum>(
    AntecedenteResponseTipoEnum.MEDICO,
  );
  protected readonly descripcionNueva = signal('');

  // --- Modo táctil (16/11/2026): tipo y zona con un toque, año con −/+ ----------------------
  protected readonly opcionesDeTipo: readonly OpcionChip[] = this.tiposDeAntecedente.map(
    ([valor, etiqueta]) => ({
      valor,
      etiqueta,
    }),
  );
  protected readonly opcionesDeZona = OPCIONES_DE_ZONA;
  protected readonly zonaEnChips = computed(() => zonaEnChips(this.zonaNueva()));
  protected readonly anioNumero = computed(() => {
    const anio = Number(this.anioNuevo());
    return this.anioNuevo() === '' || !Number.isFinite(anio) ? null : anio;
  });

  protected elegirTipo(valor: string | readonly string[] | null): void {
    if (typeof valor === 'string') {
      this.tipoNuevo.set(valor as AntecedenteResponseTipoEnum);
    }
  }

  protected elegirZonaDeCirugia(valor: string | readonly string[] | null): void {
    this.zonaNueva.set(typeof valor === 'string' ? valor : this.zonaEnChips().otra);
  }
  protected readonly intentoAntecedente = signal(false);
  protected readonly guardandoAntecedente = signal(false);
  protected readonly errorAntecedente = signal<string | null>(null);
  /** El año escrito no es un año válido: no se guarda hasta corregirlo. */
  protected readonly anioInvalido = signal(false);

  protected editarResumen(): void {
    this.resumenEscrito.set(this.historia()?.resumen ?? '');
    this.errorResumen.set(null);
    this.editandoResumen.set(true);
  }

  protected cancelarResumen(): void {
    this.editandoResumen.set(false);
  }

  protected guardarResumen(): void {
    const historia = this.historia();
    if (historia === null || this.guardandoResumen()) {
      return;
    }
    this.guardandoResumen.set(true);
    this.errorResumen.set(null);
    this.api
      .actualizarResumen(
        this.idDePersona(),
        this.resumenEscrito().trim(),
        historia.version ?? 0,
        this.justificacion(),
      )
      .subscribe({
        next: (actualizada) => {
          this.guardandoResumen.set(false);
          this.editandoResumen.set(false);
          this.estado.set({ tipo: 'lista', historia: actualizada });
          this.avisos.exito('Resumen guardado');
        },
        error: (error: unknown) => {
          this.guardandoResumen.set(false);
          this.errorResumen.set(traducirErrorHistoria(error).mensaje);
        },
      });
  }

  protected abrirAltaDeAntecedente(): void {
    this.descripcionNueva.set('');
    this.zonaNueva.set('');
    this.anioNuevo.set('');
    this.anioInvalido.set(false);
    this.lugarNuevo.set('');
    this.intentoAntecedente.set(false);
    this.errorAntecedente.set(null);
    this.agregandoAntecedente.set(true);
  }

  protected cancelarAltaDeAntecedente(): void {
    this.agregandoAntecedente.set(false);
  }

  protected guardarAntecedente(): void {
    this.intentoAntecedente.set(true);
    if (this.anioInvalido()) {
      this.errorAntecedente.set('Escribí el año con números, por ejemplo 2019.');
      return;
    }
    const descripcion = this.descripcionNueva().trim();
    if (descripcion === '' || this.guardandoAntecedente()) {
      return;
    }
    this.guardandoAntecedente.set(true);
    this.errorAntecedente.set(null);
    this.api
      .registrarAntecedente(
        this.idDePersona(),
        this.tipoNuevo() as string as RegistrarAntecedenteRequest['tipo'],
        descripcion,
        this.justificacion(),
        this.detalleDeCirugia(),
      )
      .subscribe({
        next: () => {
          this.guardandoAntecedente.set(false);
          this.agregandoAntecedente.set(false);
          this.avisos.exito('Antecedente agregado');
          this.refrescar();
        },
        error: (error: unknown) => {
          this.guardandoAntecedente.set(false);
          this.errorAntecedente.set(traducirErrorHistoria(error).mensaje);
        },
      });
  }

  private detalleDeCirugia(): Pick<RegistrarAntecedenteRequest, 'zona' | 'anio' | 'lugar'> {
    if ((this.tipoNuevo() as string) !== 'QUIRURGICO') {
      return {};
    }
    const anio = Number(this.anioNuevo());
    return {
      ...(this.zonaNueva().trim() ? { zona: this.zonaNueva().trim() } : {}),
      ...(anio ? { anio } : {}),
      ...(this.lugarNuevo().trim() ? { lugar: this.lugarNuevo().trim() } : {}),
    };
  }

  /** Relee la historia sin pasar por "cargando": la pantalla no parpadea despues de guardar. */
  private refrescar(): void {
    this.api.ver(this.idDePersona(), this.justificacion()).subscribe({
      next: (historia) => {
        this.estado.set({ tipo: 'lista', historia });
        this.huboCambios();
      },
      error: () => this.cargar(),
    });
  }

  private cargar(): void {
    if (this.visita.personaId() === null) {
      return; // El marco todavia no leyo la URL: se sigue en "cargando".
    }
    const personaId = this.idDePersona();
    if (!Number.isSafeInteger(personaId) || personaId <= 0) {
      this.estado.set({ tipo: 'error', error: errorDeCausa('no-encontrado') });
      return;
    }
    this.estado.set({ tipo: 'cargando' });
    this.errorAlAbrir.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api.ver(personaId, this.justificacion()).subscribe({
      next: (historia) => {
        this.estado.set({ tipo: 'lista', historia });
        this.cargarDeclarados(historia);
        this.cargarFicha();
      },
      error: (error: unknown) => {
        const traducido = traducirErrorHistoria(error, 'historia');
        switch (traducido.causa) {
          case 'requiere-justificacion':
            this.estado.set({ tipo: 'requiere-justificacion' });
            break;
          case 'sin-historia':
            this.estado.set({ tipo: 'sin-historia' });
            break;
          default:
            this.estado.set({ tipo: 'error', error: traducido });
        }
      },
    });
  }

  private idDePersona(): number {
    return this.visita.personaId() ?? Number.NaN;
  }
}
