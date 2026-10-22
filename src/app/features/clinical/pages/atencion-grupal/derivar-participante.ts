import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { FocoAlMontar } from '../../../../shared/directives/foco-al-montar.directive';

import { CasoAdministrativoResponse } from '../../../../api/generated/model/caso-administrativo-response';
import { DerivacionDeParticipante } from '../../../../api/generated/model/derivacion-de-participante';
import { ElegibilidadClinicaDeParticipante } from '../../../../api/generated/model/elegibilidad-clinica-de-participante';
import { ErrorAtencionGrupal } from '../../models/atencion-grupal-errors';
import { textoDeBloqueo, traducirErrorDeDerivacion } from '../../models/derivacion-errors';
import { instanteEnPalabras } from '../../models/etiquetas-de-atencion';
import {
  AtencionGrupalApi,
  CasosParaDerivar,
  MotivoDeAcceso,
} from '../../services/atencion-grupal-api';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

type Carga<T> =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error'; readonly error: ErrorAtencionGrupal }
  | { readonly tipo: 'listo'; readonly valor: T };

/** Lo que se repite cuando el panel junta el motivo de acceso: recibe el motivo declarado. */
export type ReintentoConMotivo = (motivo: MotivoDeAcceso) => void;

const ETIQUETAS_DE_ASISTENCIA: Readonly<Record<string, string>> = {
  PRESENTE: 'Presente',
  PRESENTE_TARDE: 'Llego tarde',
  AUSENTE: 'Ausente',
};

/**
 * Derivar a un participante de la clase al circuito clinico (AKINE-08.04, RF-M28-008, RF-M10-008).
 *
 * <p><b>Derivar no es atender.</b> Vincula la asistencia a un Caso Clinico existente y activo de la
 * persona; la atencion —la Sesion— se abre despues desde el panel, y es la que se numera dentro
 * del Caso. Por eso esta tarjeta no muestra ni escribe nada clinico.
 *
 * <p>Dos lecturas, ninguna clinica:
 *
 * <ol>
 *   <li><b>La elegibilidad</b> (`inscripcion:read`): si la oferta es clinica, si estuvo y si ya es
 *       paciente. Sin efectos y sin auditoria. Un bloqueo se muestra con su texto.</li>
 *   <li><b>Los casos activos</b>, por los datos administrativos de la historia (`paciente:read`):
 *       numero y fecha de apertura, nunca diagnostico ni objetivo. Elegir el Caso no necesita
 *       leer contenido clinico.</li>
 * </ol>
 *
 * <p>Lo clinico lo decide el backend al derivar (`hc:write` con relacion asistencial o motivo
 * declarado). Si pide motivo, la tarjeta se lo pide al panel —que es quien lo guarda para toda la
 * visita— y reintenta con el que se declare.
 *
 * <p><b>Nunca convierte a nadie en paciente.</b> Una persona sin perfil no tiene historia ni casos
 * donde derivarla: la tarjeta lo dice y lleva a su ficha del padron, donde se activa el perfil.
 * Abrir un Caso tampoco es de aca: pide diagnostico presuntivo, y eso es la historia clinica.
 */
@Component({
  selector: 'app-derivar-participante',
  imports: [Ayuda, RouterLink, FocoAlMontar],
  templateUrl: './derivar-participante.html',
})
export class DerivarParticipante {
  private readonly api = inject(AtencionGrupalApi);

  readonly consultorioId = input.required<number>();
  readonly claseId = input.required<number>();
  readonly inscripcionId = input.required<number>();
  readonly nombre = input.required<string>();
  /** El motivo de acceso que el panel ya junto en esta visita. */
  readonly motivo = input<MotivoDeAcceso>(null);
  /** La oferta de la clase, para senalar el Caso abierto por ella. `null` si no se conoce. */
  readonly ofertaId = input<number | null>(null);

  /** El backend pidio motivo de acceso: el panel lo junta y llama al reintento con el. */
  readonly pideMotivo = output<ReintentoConMotivo>();
  readonly derivado = output<DerivacionDeParticipante>();
  readonly cerrar = output<void>();

  protected readonly instante = instanteEnPalabras;

  protected readonly elegibilidad = signal<Carga<ElegibilidadClinicaDeParticipante>>({
    tipo: 'cargando',
  });
  /** `null` mientras no corresponda leerlos: no derivable, o todavia no es paciente. */
  protected readonly casos = signal<Carga<CasosParaDerivar> | null>(null);
  protected readonly casoElegido = signal<number | null>(null);
  protected readonly motivoDeDerivacion = signal('');
  protected readonly faltaCaso = signal(false);
  protected readonly enviando = signal(false);
  protected readonly error = signal<ErrorAtencionGrupal | null>(null);

  protected readonly veredicto = computed(() => {
    const actual = this.elegibilidad();
    return actual.tipo === 'listo' ? actual.valor : null;
  });

  protected readonly asistencia = computed(() => {
    const resultado = this.veredicto()?.resultadoAsistencia;
    return resultado ? (ETIQUETAS_DE_ASISTENCIA[resultado] ?? resultado) : 'Sin registrar';
  });

  protected readonly bloqueos = computed(() =>
    (this.veredicto()?.motivos ?? []).map((motivo) => textoDeBloqueo(motivo)),
  );

  /** Derivable, pero todavia no es paciente: no hay historia ni caso donde derivarla. */
  protected readonly faltaPerfil = computed(() => {
    const veredicto = this.veredicto();
    return (
      veredicto?.derivable === true &&
      (veredicto.esPacienteVigente !== true || veredicto.requiereActivarPerfil === true)
    );
  });

  protected readonly rutaDeLaFicha = computed(() => {
    const personaId = this.veredicto()?.personaId;
    return personaId === undefined ? null : `/pacientes/${personaId}`;
  });

  protected readonly rutaDeLaHistoria = computed(() => {
    const personaId = this.veredicto()?.personaId;
    return personaId === undefined ? null : `/historia-clinica/personas/${personaId}`;
  });

  /** Respuesta mas nueva pedida: la de otro participante que llega tarde no pisa a la actual. */
  private pedido = 0;

  constructor() {
    effect(() => {
      const ids = {
        consultorioId: this.consultorioId(),
        claseId: this.claseId(),
        inscripcionId: this.inscripcionId(),
      };
      untracked(() => this.cargar(ids));
    });
  }

  protected recargar(): void {
    this.cargar({
      consultorioId: this.consultorioId(),
      claseId: this.claseId(),
      inscripcionId: this.inscripcionId(),
    });
  }

  private cargar(ids: { consultorioId: number; claseId: number; inscripcionId: number }): void {
    const pedido = ++this.pedido;
    this.elegibilidad.set({ tipo: 'cargando' });
    this.casos.set(null);
    this.casoElegido.set(null);
    this.motivoDeDerivacion.set('');
    this.faltaCaso.set(false);
    this.error.set(null);
    this.api.elegibilidad(ids.consultorioId, ids.claseId, ids.inscripcionId).subscribe({
      next: (veredicto) => {
        if (pedido !== this.pedido) {
          return;
        }
        this.elegibilidad.set({ tipo: 'listo', valor: veredicto });
        if (!this.faltaPerfil() && veredicto.derivable === true && veredicto.personaId) {
          this.cargarCasos(veredicto.personaId, pedido);
        }
      },
      error: (error: unknown) => {
        if (pedido === this.pedido) {
          this.elegibilidad.set({ tipo: 'error', error: traducirErrorDeDerivacion(error) });
        }
      },
    });
  }

  private cargarCasos(personaId: number, pedido: number): void {
    this.casos.set({ tipo: 'cargando' });
    this.api.casosParaDerivar(personaId).subscribe({
      next: (valor) => {
        if (pedido !== this.pedido) {
          return;
        }
        this.casos.set({ tipo: 'listo', valor });
        // Con un solo caso activo no hay nada que elegir; igual se muestra cual es.
        if (valor.casos.length === 1) {
          this.casoElegido.set(valor.casos[0].id ?? null);
        }
      },
      error: (error: unknown) => {
        if (pedido === this.pedido) {
          this.casos.set({ tipo: 'error', error: traducirErrorDeDerivacion(error) });
        }
      },
    });
  }

  protected etiquetaDeCaso(caso: CasoAdministrativoResponse): string {
    const partes = [
      caso.numeroCaso === undefined ? 'Caso clinico sin numero' : `Caso clinico ${caso.numeroCaso}`,
    ];
    const apertura = instanteEnPalabras(caso.abiertoEn);
    if (apertura !== '') {
      partes.push(`abierto el ${apertura}`);
    }
    if (this.ofertaId() !== null && caso.ofertaId === this.ofertaId()) {
      partes.push('de la oferta de esta clase');
    }
    return partes.join(' · ');
  }

  protected elegir(casoId: number | undefined): void {
    this.casoElegido.set(casoId ?? null);
    this.faltaCaso.set(false);
  }

  protected derivar(motivoDeAcceso: MotivoDeAcceso = this.motivo()): void {
    const casoClinicoId = this.casoElegido();
    if (this.enviando()) {
      return;
    }
    if (casoClinicoId === null) {
      this.faltaCaso.set(true);
      return;
    }
    const motivo = this.motivoDeDerivacion().trim();
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .derivar(
        this.consultorioId(),
        this.claseId(),
        this.inscripcionId(),
        motivo === '' ? { casoClinicoId } : { casoClinicoId, motivo },
        motivoDeAcceso,
      )
      .subscribe({
        next: (derivacion) => {
          this.enviando.set(false);
          this.derivado.emit(derivacion);
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorDeDerivacion(error);
          if (traducido.causa === 'requiere-justificacion') {
            this.pideMotivo.emit((declarado) => this.derivar(declarado));
          }
          this.error.set(traducido);
        },
      });
  }
}
