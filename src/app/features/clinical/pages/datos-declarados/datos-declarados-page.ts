import { HttpResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, Subscription, firstValueFrom } from 'rxjs';

import { PersonasService } from '../../../../api/generated/api/personas.service';
import { AdjuntoClinicoResponseCategoriaEnum } from '../../../../api/generated/model/adjunto-clinico-response';
import { AntecedenteResponseTipoEnum } from '../../../../api/generated/model/antecedente-response';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { cabeceraDePersona } from '../../../../core/services/cabecera-de-persona';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDeFicha } from '../../../../shared/components/cabecera-de-ficha/cabecera-de-ficha';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Icono } from '../../../../shared/components/icono/icono';
import { tamanoEnPalabras } from '../../../../shared/utils/archivos';
import { ImagenNoLegible, prepararArchivoParaSubir } from '../../../../shared/utils/imagenes';
import { DictadoDeFicha } from '../../components/dictado-de-ficha/dictado-de-ficha';
import {
  ENFERMEDADES_DE_INGRESO,
  FichaDeIngreso,
  TildeDeEnfermedad,
} from '../../components/ficha-de-ingreso/ficha-de-ingreso';
import { FichaDictada, resumirDictado } from '../../models/dictado-de-ficha';
import { CATEGORIAS_DE_ADJUNTO, TIPOS_DE_ANTECEDENTE } from '../../models/etiquetas-de-historia';
import { traducirErrorHistoria } from '../../models/historia-errors';
import { VisorDeAdjunto } from '../historia-clinica/components/visor-de-adjunto';
import { Chips, OpcionChip } from '../../../../shared/components/chips/chips';
import { NumeroConPasos } from '../../../../shared/components/numero-con-pasos/numero-con-pasos';
import { TextoOpcional } from '../../../../shared/components/texto-opcional/texto-opcional';
import { OPCIONES_DE_ZONA, zonaEnChips } from '../../models/zonas-del-cuerpo';
import {
  AdjuntoDeclarado,
  AntecedenteDeclarado,
  DatosDeclaradosApi,
  DatosDeclaradosResponse,
  DetalleDeAntecedente,
  FichaDeIngresoRequest,
  OcupacionResponse,
  TipoDatoDeclarado,
} from './datos-declarados.api';

/** Motivo fijo de la baja cuando se destilda una enfermedad que nadie reviso. */
export const MOTIVO_DESTILDADO = 'Destildado en la ficha de ingreso';

/** Texto sugerido del motivo de acceso (diseño §7): se puede cambiar antes de seguir. */
export const MOTIVO_SUGERIDO = 'Carga de datos que declara el paciente';

/** Categorias que se pueden declarar (DP-47). Consentimiento y evolucion escaneada son del profesional. */
const CATEGORIAS_DECLARABLES: readonly AdjuntoClinicoResponseCategoriaEnum[] = [
  AdjuntoClinicoResponseCategoriaEnum.ESTUDIO,
  AdjuntoClinicoResponseCategoriaEnum.INFORME,
  AdjuntoClinicoResponseCategoriaEnum.IMAGEN,
  AdjuntoClinicoResponseCategoriaEnum.OTRO,
];

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'sin-perfil' }
  | { readonly tipo: 'lista'; readonly datos: DatosDeclaradosResponse }
  | { readonly tipo: 'error'; readonly mensaje: string };

/** Lo que se esta por dar de baja. */
interface Baja {
  readonly tipoDato: TipoDatoDeclarado;
  readonly id: number;
  readonly descripcion: string;
}

/**
 * Los datos que declara el paciente (DP-47, diseño §8.1).
 *
 * <p>La usa el mostrador, que no lee la historia: solo ve lo DECLARADO, lo carga, lo abre y da de
 * baja lo que nadie reviso todavia. Lo que cargo un profesional nunca llega a esta pantalla.
 */
@Component({
  selector: 'app-datos-declarados-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    Chips,
    NumeroConPasos,
    TextoOpcional,
    AccionesDeFila,
    Alerta,
    Ayuda,
    CabeceraDeFicha,
    ConfirmacionConMotivo,
    DictadoDeFicha,
    EstadoVacio,
    FichaDeIngreso,
    Icono,
    RouterLink,
    VisorDeAdjunto,
  ],
  templateUrl: './datos-declarados-page.html',
  styleUrl: './datos-declarados-page.css',
})
export class DatosDeclaradosPage {
  private readonly api = inject(DatosDeclaradosApi);
  private readonly personas = inject(PersonasService);
  private readonly avisos = inject(AvisosStore);

  /** De la ruta (`withComponentInputBinding`). */
  readonly personaId = input.required<string>();

  protected readonly id = computed(() => Number(this.personaId()));

  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly estado = signal<Estado>({ tipo: 'cargando' });

  /**
   * El motivo de acceso de esta visita. Arranca con el sugerido para no frenar la carga con una
   * pantalla previa; no se muestra y viaja con cada pedido (DP-03).
   */
  protected readonly justificacion = signal<string | null>(MOTIVO_SUGERIDO);

  protected readonly tipos = Object.entries(TIPOS_DE_ANTECEDENTE) as [
    AntecedenteResponseTipoEnum,
    string,
  ][];
  protected readonly tipoNuevo = signal<AntecedenteResponseTipoEnum>(
    AntecedenteResponseTipoEnum.ALERGIA,
  );
  protected readonly descripcionNueva = signal('');

  // --- Modo táctil (16/11/2026): tipo y zona con un toque, año con −/+ ----------------------
  protected readonly opcionesDeTipo: readonly OpcionChip[] = this.tipos.map(
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

  protected readonly categoriasDeclarables = CATEGORIAS_DECLARABLES;
  protected readonly categoriaNueva = signal<AdjuntoClinicoResponseCategoriaEnum>(
    AdjuntoClinicoResponseCategoriaEnum.ESTUDIO,
  );
  protected readonly subiendo = signal(0);
  protected readonly errorSubida = signal<string | null>(null);
  protected readonly arrastrando = signal(false);
  protected readonly adjuntoAbierto = signal<number | null>(null);

  /** Ficha de ingreso: catalogo de ocupaciones (se carga una vez) y guardado en curso. */
  protected readonly ocupaciones = signal<readonly OcupacionResponse[]>([]);
  protected readonly guardandoFicha = signal(false);
  private readonly fichaDeIngreso = viewChild(FichaDeIngreso);

  /** Detalle de una cirugia, en la misma linea del alta cuando el tipo es Quirurgico. */
  protected readonly zonaNueva = signal('');
  protected readonly anioNuevo = signal('');
  protected readonly lugarNuevo = signal('');
  protected readonly anioMaximo = new Date().getFullYear();

  protected readonly baja = signal<Baja | null>(null);
  protected readonly dandoDeBaja = signal(false);

  protected readonly cabecera = cabeceraDePersona(() => ({
    personaId: this.personaId(),
    persona: this.persona(),
    actual: 'declarados',
    esPaciente: true,
  }));

  protected readonly datos = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'lista' ? estado.datos : null;
  });

  protected readonly rutaFicha = computed(() => `/pacientes/${this.personaId()}`);

  /** Los antecedentes de la lista de abajo: las enfermedades tildadas ya se ven en la ficha. */
  protected readonly antecedentesSueltos = computed(() =>
    (this.datos()?.antecedentes ?? []).filter((a) => !a.codigo),
  );

  /** Enfermedades de la lista que esta pantalla ve tildadas (solo lo declarado). */
  protected readonly enfermedadesTildadas = computed(
    () =>
      new Set(
        (this.datos()?.antecedentes ?? []).flatMap((a) => (a.codigo ? [a.codigo as string] : [])),
      ),
  );

  /** Las revisadas ya no se destildan desde aca. */
  protected readonly enfermedadesFijas = computed(
    () =>
      new Set(
        (this.datos()?.antecedentes ?? []).flatMap((a) =>
          a.codigo && this.revisado(a) ? [a.codigo as string] : [],
        ),
      ),
  );

  /** La descarga del visor para un adjunto declarado. */
  protected descargaDe(adjuntoId: number | undefined): () => Observable<HttpResponse<Blob>> {
    return () => this.api.contenido(this.id(), adjuntoId ?? 0, this.justificacion());
  }

  private pedido: Subscription | null = null;

  constructor() {
    // Cambio de persona (o de sede, que recrea la pantalla): todo vuelve a empezar.
    effect(() => {
      const personaId = this.id();
      untracked(() => {
        this.pedido?.unsubscribe();
        this.estado.set({ tipo: 'cargando' });
        this.persona.set(null);
        this.adjuntoAbierto.set(null);
        // La ficha solo da el nombre de la cabecera: si falla, la pantalla sigue sin el.
        this.personas.verPersona({ personaId }).subscribe({
          next: (persona) => this.persona.set(persona),
          error: () => this.persona.set(null),
        });
        this.cargar();
      });
    });
    // El catalogo no depende de la persona: una vez por pantalla. Sin el, la ficha igual escribe.
    this.api.ocupaciones().subscribe({
      next: (lista) => this.ocupaciones.set(lista),
      error: () => this.ocupaciones.set([]),
    });
  }

  protected guardarFicha(ficha: FichaDeIngresoRequest): void {
    this.guardandoFicha.set(true);
    this.api.declararFicha(this.id(), ficha, this.justificacion()).subscribe({
      next: (guardada) => {
        this.guardandoFicha.set(false);
        this.estado.update((estado) =>
          estado.tipo === 'lista'
            ? { tipo: 'lista', datos: { ...estado.datos, ficha: guardada } }
            : estado,
        );
      },
      error: (error: unknown) => {
        // Primero se descarta la cola: lo que estaba esperando se apoyaba en un guardado que no fue.
        this.fichaDeIngreso()?.fallo();
        this.guardandoFicha.set(false);
        if (esSinPerfil(error)) {
          this.estado.set({ tipo: 'sin-perfil' });
          return;
        }
        this.avisos.error('No pudimos guardar la ficha', { descripcion: mensajeDe(error) });
        // Otra persona la cambio: se relee sin destruir la pantalla. Un 400 deja lo escrito para corregir.
        if (error instanceof AkineHttpError && error.status === 409) {
          this.refrescar();
        }
      },
    });
  }

  /** Relee lo declarado sin pasar por "cargando": la ficha y los formularios no se recrean. */
  private refrescar(): void {
    this.api.ver(this.id(), this.justificacion()).subscribe({
      next: (datos) => this.estado.set({ tipo: 'lista', datos }),
      error: () => this.cargar(),
    });
  }

  protected agregarOcupacion(nombre: string): void {
    this.api.agregarOcupacion(nombre).subscribe({
      next: (ocupacion) => {
        this.ocupaciones.update((lista) =>
          lista.some((o) => o.id === ocupacion.id)
            ? lista
            : [...lista, ocupacion].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
        );
        this.fichaDeIngreso()?.guardarOcupacion(ocupacion.id);
      },
      error: (error: unknown) =>
        this.avisos.error('No pudimos agregar la ocupación', { descripcion: mensajeDe(error) }),
    });
  }

  protected tildarEnfermedad(tilde: TildeDeEnfermedad): void {
    if (tilde.marcado) {
      this.api
        .declararAntecedente(this.id(), 'MEDICO', tilde.etiqueta, this.justificacion(), {
          codigo: tilde.codigo,
        })
        .subscribe({
          next: () => this.refrescar(),
          error: (error: unknown) => {
            this.avisos.error('No pudimos guardar el tilde', { descripcion: mensajeDe(error) });
            this.refrescar();
          },
        });
      return;
    }
    const tildada = this.datos()?.antecedentes?.find((a) => a.codigo === tilde.codigo);
    if (tildada?.id === undefined) {
      return;
    }
    this.api
      .darDeBaja(this.id(), 'antecedentes', tildada.id, MOTIVO_DESTILDADO, this.justificacion())
      .subscribe({
        next: () => this.refrescar(),
        error: (error: unknown) => {
          this.avisos.error('No pudimos quitar el tilde', { descripcion: mensajeDe(error) });
          this.refrescar();
        },
      });
  }

  /**
   * Carga lo elegido de un dictado. Primero condiciones y antecedentes, de a uno; después una sola
   * relectura, y recién ahí la ficha: así su guardado sale con la versión vigente y nada lo pisa.
   */
  protected async cargarDictado(dictado: FichaDictada): Promise<void> {
    const tildadas = this.enfermedadesTildadas();
    let fallas = 0;
    const pedidos = [
      ...dictado.condiciones
        .filter((codigo) => !tildadas.has(codigo))
        .map(
          (codigo) => () =>
            this.api.declararAntecedente(
              this.id(),
              'MEDICO',
              ENFERMEDADES_DE_INGRESO.find(([c]) => c === codigo)?.[1] ?? codigo,
              this.justificacion(),
              { codigo },
            ),
        ),
      ...dictado.antecedentes.map(
        (a) => () =>
          this.api.declararAntecedente(this.id(), a.tipo, a.descripcion, this.justificacion(), {
            ...(a.zona ? { zona: a.zona } : {}),
            ...(a.anio ? { anio: a.anio } : {}),
          }),
      ),
    ];
    for (const pedido of pedidos) {
      try {
        await firstValueFrom(pedido());
      } catch (error: unknown) {
        if (esSinPerfil(error)) {
          this.estado.set({ tipo: 'sin-perfil' });
          return;
        }
        fallas++;
      }
    }
    if (pedidos.length > 0) {
      try {
        const datos = await firstValueFrom(this.api.ver(this.id(), this.justificacion()));
        this.estado.set({ tipo: 'lista', datos });
      } catch {
        // Sin relectura la ficha igual guarda; la lista se pone al día en la próxima carga.
      }
    }
    this.fichaDeIngreso()?.aplicarDictado(dictado);
    if (fallas > 0) {
      this.avisos.error('Parte del dictado no se cargó', {
        descripcion: `${fallas} de ${pedidos.length} datos fallaron. Revisalos y cargalos a mano.`,
      });
    } else {
      this.avisos.exito('Dictado cargado', {
        descripcion: `${resumirDictado(dictado)}. Queda sin revisar hasta que lo vea un profesional.`,
      });
    }
  }

  protected problemaDeDictado(mensaje: string): void {
    this.avisos.error('Dictado', { descripcion: mensaje });
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });
    this.pedido?.unsubscribe();
    this.pedido = this.api.ver(this.id(), this.justificacion()).subscribe({
      next: (datos) => this.estado.set({ tipo: 'lista', datos }),
      error: (error: unknown) => {
        if (esSinPerfil(error)) {
          this.estado.set({ tipo: 'sin-perfil' });
          return;
        }
        this.estado.set({ tipo: 'error', mensaje: mensajeDe(error) });
      },
    });
  }

  protected agregarAntecedente(): void {
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
      .declararAntecedente(
        this.id(),
        this.tipoNuevo(),
        descripcion,
        this.justificacion(),
        this.detalleDeCirugia(),
      )
      .subscribe({
        next: () => {
          this.guardandoAntecedente.set(false);
          this.intentoAntecedente.set(false);
          this.descripcionNueva.set('');
          this.zonaNueva.set('');
          this.anioNuevo.set('');
          this.anioInvalido.set(false);
          this.lugarNuevo.set('');
          this.avisos.exito('Antecedente cargado', {
            descripcion: 'Queda sin revisar hasta que lo vea un profesional.',
          });
          this.cargar();
        },
        error: (error: unknown) => {
          this.guardandoAntecedente.set(false);
          if (esSinPerfil(error)) {
            this.estado.set({ tipo: 'sin-perfil' });
            return;
          }
          this.errorAntecedente.set(mensajeDe(error));
        },
      });
  }

  /** Zona, año y lugar, solo para una cirugia y solo lo escrito. */
  private detalleDeCirugia(): DetalleDeAntecedente {
    if (this.tipoNuevo() !== AntecedenteResponseTipoEnum.QUIRURGICO) {
      return {};
    }
    const anio = Number(this.anioNuevo());
    return {
      ...(this.zonaNueva().trim() ? { zona: this.zonaNueva().trim() } : {}),
      ...(anio ? { anio } : {}),
      ...(this.lugarNuevo().trim() ? { lugar: this.lugarNuevo().trim() } : {}),
    };
  }

  /** "Rodilla derecha · 2019 · Hospital Privado", o vacio si no tiene detalle. */
  protected detalleDe(antecedente: AntecedenteDeclarado): string {
    return [antecedente.zona, antecedente.anio, antecedente.lugar]
      .filter((parte) => parte !== undefined && parte !== null && parte !== '')
      .join(' · ');
  }

  /** Lo que llega de la camara, del selector o arrastrado: cada archivo se sube en el acto. */
  protected elegirArchivos(entrada: HTMLInputElement): void {
    const archivos = Array.from(entrada.files ?? []);
    entrada.value = '';
    this.subirArchivos(archivos).catch(() => undefined);
  }

  protected alArrastrar(evento: DragEvent, encima: boolean): void {
    evento.preventDefault();
    this.arrastrando.set(encima);
  }

  protected alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
    this.subirArchivos(Array.from(evento.dataTransfer?.files ?? [])).catch(() => undefined);
  }

  private async subirArchivos(archivos: readonly File[]): Promise<void> {
    if (archivos.length === 0) {
      return;
    }
    this.errorSubida.set(null);
    let alguno = false;
    for (const original of archivos) {
      this.subiendo.update((n) => n + 1);
      try {
        const archivo = await prepararArchivoParaSubir(original);
        await firstValueFrom(
          this.api.declararAdjunto(
            this.id(),
            archivo,
            this.categoriaNueva(),
            '',
            this.justificacion(),
          ),
        );
        alguno = true;
      } catch (error: unknown) {
        if (esSinPerfil(error)) {
          this.estado.set({ tipo: 'sin-perfil' });
          return;
        }
        this.errorSubida.set(
          error instanceof ImagenNoLegible
            ? error.message
            : `${original.name}: ${mensajeDe(error)}`,
        );
      } finally {
        this.subiendo.update((n) => n - 1);
      }
    }
    if (alguno) {
      this.avisos.exito(archivos.length === 1 ? 'Archivo cargado' : 'Archivos cargados', {
        descripcion: 'Quedan sin revisar hasta que los vea un profesional.',
      });
      this.cargar();
    }
  }

  protected alternarAdjunto(adjuntoId: number | undefined): void {
    if (adjuntoId === undefined) {
      return;
    }
    this.adjuntoAbierto.update((actual) => (actual === adjuntoId ? null : adjuntoId));
  }

  protected pedirBaja(
    tipoDato: TipoDatoDeclarado,
    id: number | undefined,
    descripcion: string | undefined,
  ): void {
    if (id === undefined) {
      return;
    }
    this.baja.set({ tipoDato, id, descripcion: descripcion ?? '' });
  }

  protected confirmarBaja(motivo: string): void {
    const baja = this.baja();
    if (baja === null || this.dandoDeBaja()) {
      return;
    }
    this.dandoDeBaja.set(true);
    this.api.darDeBaja(this.id(), baja.tipoDato, baja.id, motivo, this.justificacion()).subscribe({
      next: () => {
        this.dandoDeBaja.set(false);
        this.baja.set(null);
        this.avisos.exito('Dato dado de baja');
        this.cargar();
      },
      error: (error: unknown) => {
        this.dandoDeBaja.set(false);
        this.baja.set(null);
        this.avisos.error('No pudimos darlo de baja', { descripcion: mensajeDe(error) });
        this.cargar();
      },
    });
  }

  protected etiquetaDeTipo(tipo: string | undefined): string {
    return tipo === undefined
      ? ''
      : (TIPOS_DE_ANTECEDENTE[tipo as AntecedenteResponseTipoEnum] ?? tipo);
  }

  protected etiquetaDeCategoria(categoria: string | undefined): string {
    return categoria === undefined
      ? ''
      : (CATEGORIAS_DE_ADJUNTO[categoria as AdjuntoClinicoResponseCategoriaEnum] ?? categoria);
  }

  protected tamano(bytes: number | undefined): string {
    return bytes === undefined ? '' : tamanoEnPalabras(bytes);
  }

  protected revisado(dato: AntecedenteDeclarado | AdjuntoDeclarado): boolean {
    return dato.revisadoEn !== null && dato.revisadoEn !== undefined;
  }

  /** "Revisado · Dr. Pérez, 15/11" o "Sin revisar · Ana, 14/11". */
  protected estadoDe(
    dato: AntecedenteDeclarado | AdjuntoDeclarado,
    cargadoEn: string | undefined,
  ): string {
    if (this.revisado(dato)) {
      return `Revisado · ${quienYCuando(dato.revisadoPorNombre, dato.revisadoEn ?? null)}`;
    }
    return `Sin revisar · ${quienYCuando(dato.cargadoPorNombre, cargadoEn ?? null)}`;
  }
}

function quienYCuando(nombre: string | null | undefined, instante: string | null): string {
  const fecha =
    instante === null
      ? ''
      : new Date(instante).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  return [nombre ?? null, fecha || null].filter((parte) => parte !== null).join(', ');
}

function esSinPerfil(error: unknown): boolean {
  return (
    error instanceof AkineHttpError &&
    error.status === 409 &&
    error.problemType === 'persona-sin-perfil-paciente'
  );
}

/** El mensaje de una falla. Los tres conflictos de DP-47 tienen texto propio; el resto, como en la historia. */
function mensajeDe(error: unknown): string {
  return mensajePropio(error) ?? traducirErrorHistoria(error).mensaje;
}

function mensajePropio(error: unknown): string | null {
  if (!(error instanceof AkineHttpError)) {
    return null;
  }
  const tipo = (error.problemType ?? undefined) as string | undefined;
  return (tipo === undefined ? undefined : MENSAJES_DECLARADOS[tipo]) ?? null;
}

const MENSAJES_DECLARADOS: Readonly<Record<string, string>> = {
  'dato-declarado-revisado':
    'Ya lo revisó un profesional: sólo él puede darlo de baja desde la historia.',
  'dato-no-declarado': 'Ese dato no es declarado: no lleva revisión.',
  'adjunto-ya-en-historia': 'Ese archivo ya está en la historia clínica.',
  'dato-ya-en-historia': 'Ya está registrado en la historia clínica: lo maneja el profesional.',
};
