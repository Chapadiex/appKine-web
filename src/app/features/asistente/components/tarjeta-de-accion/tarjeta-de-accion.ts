import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { AccionPropuesta } from '../../../../api/generated/model/accion-propuesta';
import { ConfirmarAccion } from '../../../../api/generated/model/confirmar-accion';
import { DatosDePersona } from '../../../../api/generated/model/datos-de-persona';
import { ResultadoDeAccion } from '../../../../api/generated/model/resultado-de-accion';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { Dictado } from '../../../../shared/dictado/dictado.directive';
import { formatearInstante } from '../../../../shared/utils/instantes';
import { traducirErrorAsistente } from '../../models/asistente-errors';
import {
  aCentavos,
  motivoQueImpideConfirmar,
  sumaDeImputaciones,
} from '../../models/tarjeta-de-accion';
import { AsistenteApi } from '../../services/asistente-api';

let siguienteId = 0;

type Estado = 'propuesta' | 'enviando' | 'confirmada' | 'descartada' | 'vencida';
type CampoDePersona = keyof DatosDePersona;

const MEDIOS: readonly { valor: string; etiqueta: string }[] = [
  { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia' },
  { valor: 'TARJETA_DEBITO', etiqueta: 'Tarjeta de débito' },
  { valor: 'TARJETA_CREDITO', etiqueta: 'Tarjeta de crédito' },
];
const DINERO = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Una acción que el asistente propone: lo que entendió, para corregirlo y confirmarlo. **Nada se
 * graba hasta "Confirmar"**; el servidor revalida todo con los permisos de quien confirma.
 *
 * La tarjeta edita una copia del bloque de su tipo y la devuelve tal cual quedó. Vence sola.
 */
@Component({
  selector: 'app-tarjeta-de-accion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Dictado, RouterLink],
  templateUrl: './tarjeta-de-accion.html',
  styleUrl: './tarjeta-de-accion.css',
})
export class TarjetaDeAccion {
  private readonly api = inject(AsistenteApi);
  private readonly diaDeLaSede = inject(DiaDeLaSede);

  readonly accion = input.required<AccionPropuesta>();
  readonly consultorioId = input.required<number>();

  protected readonly id = `accion-${++siguienteId}`;
  protected readonly medios = MEDIOS;

  /** La copia que se edita: el bloque del tipo de la acción. */
  protected readonly borrador = linkedSignal<ConfirmarAccion>(() => {
    const a = this.accion();
    return structuredClone({
      asistencia: a.asistencia,
      pago: a.pago,
      atencion: a.atencion,
      llegada: a.llegada,
      paciente: a.paciente,
    });
  });
  // Atados a la acción, igual que el borrador: otra acción en la misma tarjeta arranca de cero.
  protected readonly estado = linkedSignal<AccionPropuesta, Estado>({
    source: this.accion,
    computation: () => 'propuesta',
  });
  protected readonly resultado = linkedSignal<AccionPropuesta, ResultadoDeAccion | null>({
    source: this.accion,
    computation: () => null,
  });
  protected readonly rechazo = linkedSignal<AccionPropuesta, string | null>({
    source: this.accion,
    computation: () => null,
  });

  protected readonly editable = computed(() => this.estado() === 'propuesta');
  protected readonly clase = computed(() => {
    const a = this.borrador().asistencia;
    return a?.clases?.find((c) => c.claseId === a.claseId) ?? null;
  });
  protected readonly imputado = computed(() =>
    sumaDeImputaciones(this.borrador().pago?.imputaciones),
  );
  protected readonly anticipo = computed(() =>
    aCentavos((this.borrador().pago?.total ?? 0) - this.imputado()),
  );
  protected readonly esAlta = computed(() => this.accion().tipo === 'PACIENTE_ALTA');

  /** Por qué no se puede confirmar todavía, o `null`. Los bloqueos del servidor mandan. */
  protected readonly falta = computed(() =>
    this.accion().bloqueos.length > 0
      ? this.accion().bloqueos[0]
      : motivoQueImpideConfirmar(this.accion().tipo, this.borrador()),
  );
  protected readonly puedeConfirmar = computed(() => this.editable() && this.falta() === null);
  /** El texto que explica por qué "Confirmar" está apagado: tiene que existir en la pantalla. */
  protected readonly descritoPor = computed(() => {
    if (this.accion().bloqueos.length > 0) {
      return `${this.id}-bloqueo-0`;
    }
    return this.editable() && this.falta() ? `${this.id}-falta` : null;
  });

  constructor() {
    const vencimiento = setInterval(() => {
      if (this.estado() === 'propuesta' && Date.parse(this.accion().venceEn) <= Date.now()) {
        this.estado.set('vencida');
      }
    }, 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(vencimiento));
  }

  protected hora(instante: string | undefined): string {
    return instante ? (formatearInstante(instante, this.diaDeLaSede.zona()) ?? instante) : '';
  }

  protected dinero(importe: number | undefined): string {
    return DINERO.format(importe ?? 0);
  }

  // --- Asistencia -------------------------------------------------------------------------------

  protected elegirClase(evento: Event): void {
    const claseId = Number((evento.target as HTMLSelectElement).value) || undefined;
    this.borrador.update((b) => ({ ...b, asistencia: { ...b.asistencia, claseId } }));
  }

  protected marcar(inscripcionId: number | undefined, evento: Event): void {
    const resultado = (evento.target as HTMLSelectElement).value || undefined;
    this.borrador.update((b) => ({
      ...b,
      asistencia: {
        ...b.asistencia,
        clases: b.asistencia?.clases?.map((c) =>
          c.claseId !== b.asistencia?.claseId
            ? c
            : {
                ...c,
                items: c.items?.map((i) =>
                  i.inscripcionId === inscripcionId ? { ...i, resultado } : i,
                ),
              },
        ),
      },
    }));
  }

  // --- Pago -------------------------------------------------------------------------------------

  protected cambiarTotal(evento: Event): void {
    const total = numero(evento);
    this.borrador.update((b) => ({ ...b, pago: { ...b.pago, total } }));
  }

  protected cambiarMedio(evento: Event): void {
    const medio = (evento.target as HTMLSelectElement).value || undefined;
    this.borrador.update((b) => ({ ...b, pago: { ...b.pago, medio } }));
  }

  protected cambiarImputacion(obligacionId: number | undefined, evento: Event): void {
    const importe = numero(evento) ?? 0;
    this.borrador.update((b) => ({
      ...b,
      pago: {
        ...b.pago,
        imputaciones: b.pago?.imputaciones?.map((i) =>
          i.obligacionId === obligacionId ? { ...i, importe } : i,
        ),
      },
    }));
  }

  // --- Atención ---------------------------------------------------------------------------------

  protected elegirEnAtencion(campo: 'turnoId' | 'ofertaId' | 'casoId', evento: Event): void {
    const valor = Number((evento.target as HTMLSelectElement).value) || undefined;
    this.borrador.update((b) => ({ ...b, atencion: { ...b.atencion, [campo]: valor } }));
  }

  protected quitarTratamiento(indice: number): void {
    this.borrador.update((b) => ({
      ...b,
      atencion: {
        ...b.atencion,
        tratamientos: b.atencion?.tratamientos?.filter((_, i) => i !== indice),
      },
    }));
  }

  protected cambiarNota(evento: Event): void {
    const nota = (evento.target as HTMLTextAreaElement).value;
    this.borrador.update((b) => ({ ...b, atencion: { ...b.atencion, nota } }));
  }

  protected cambiarCerrar(evento: Event): void {
    const cerrar = (evento.target as HTMLInputElement).checked;
    this.borrador.update((b) => ({ ...b, atencion: { ...b.atencion, cerrar } }));
  }

  // --- Paciente ---------------------------------------------------------------------------------

  protected cambiarDato(campo: CampoDePersona, evento: Event): void {
    const valor = (evento.target as HTMLInputElement).value.trim() || undefined;
    this.borrador.update((b) => ({
      ...b,
      paciente: { ...b.paciente, datos: { ...b.paciente?.datos, [campo]: valor } },
    }));
  }

  protected confirmarDuplicado(evento: Event): void {
    const confirmaPosibleDuplicado = (evento.target as HTMLInputElement).checked;
    this.borrador.update((b) => ({ ...b, paciente: { ...b.paciente, confirmaPosibleDuplicado } }));
  }

  // --- Confirmar y descartar --------------------------------------------------------------------

  protected confirmar(): void {
    if (!this.puedeConfirmar()) {
      return;
    }
    const cuerpo = this.borrador();
    const pago = cuerpo.pago ? { ...cuerpo.pago, anticipo: this.anticipo() } : undefined;
    this.estado.set('enviando');
    this.rechazo.set(null);
    this.api
      .confirmarAccion(this.consultorioId(), this.accion().id, { ...cuerpo, pago })
      .subscribe({
        next: (resultado) => {
          if (resultado.estado === 'CONFIRMADA') {
            this.resultado.set(resultado);
            this.estado.set('confirmada');
          } else {
            this.rechazo.set(resultado.texto);
            this.estado.set('propuesta');
          }
        },
        error: (error: unknown) => {
          const traducido = traducirErrorAsistente(error);
          if (traducido.causa === 'no-vigente') {
            this.estado.set('vencida');
          } else {
            this.rechazo.set(traducido.mensaje);
            this.estado.set('propuesta');
          }
        },
      });
  }

  protected descartar(): void {
    if (!this.editable()) {
      return;
    }
    this.estado.set('descartada');
    // Si el descarte no llega, la propuesta vence sola: no hay nada que deshacer en pantalla.
    this.api
      .descartarAccion(this.consultorioId(), this.accion().id)
      .subscribe({ error: () => undefined });
  }
}

function numero(evento: Event): number | undefined {
  const crudo = (evento.target as HTMLInputElement).value;
  const valor = Number(crudo);
  return crudo.trim() === '' || !Number.isFinite(valor) ? undefined : valor;
}
