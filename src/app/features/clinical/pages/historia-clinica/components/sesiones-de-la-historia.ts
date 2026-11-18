import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { EventoClinicoResponse } from '../../../../../api/generated/model/evento-clinico-response';
import { Ayuda } from '../../../../../shared/components/ayuda/ayuda';
import { EstadoVacio } from '../../../../../shared/components/estado-vacio/estado-vacio';
import { traducirErrorHistoria } from '../../../models/historia-errors';
import { HistoriaClinicaApi, Justificacion } from '../../../services/historia-clinica-api';

/** Filtro fijo del timeline: solo las sesiones. */
const SOLO_SESIONES = { casoId: null, origenes: ['SESION' as const], desde: null, hasta: null };

const DIA = new Intl.DateTimeFormat('es-AR', { day: '2-digit' });
const MES = new Intl.DateTimeFormat('es-AR', { month: 'short' });
const ANIO = new Intl.DateTimeFormat('es-AR', { year: 'numeric' });
const HORA = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' });
const DIA_DE_SEMANA = new Intl.DateTimeFormat('es-AR', { weekday: 'long' });

interface SesionDeLaLista {
  readonly id: number;
  readonly titulo: string;
  readonly dia: string;
  readonly mes: string;
  readonly anio: string;
  readonly hora: string;
  readonly diaDeSemana: string;
  readonly hace: string;
}

/** "hoy", "hace 3 días", "hace 2 meses": la distancia que un profesional lee de un vistazo. */
function haceCuanto(fecha: Date, ahora: Date): string {
  const dias = Math.floor((ahora.getTime() - fecha.getTime()) / 86_400_000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return meses === 1 ? 'hace un mes' : `hace ${meses} meses`;
  const anios = Math.floor(meses / 12);
  return anios === 1 ? 'hace un año' : `hace ${anios} años`;
}

function aLista(evento: EventoClinicoResponse, ahora: Date): SesionDeLaLista | null {
  if (evento.referencia === undefined || evento.ocurrioEn === undefined) {
    return null;
  }
  const fecha = new Date(evento.ocurrioEn);
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  return {
    id: evento.referencia,
    titulo: evento.titulo?.trim() || 'Sesión',
    dia: DIA.format(fecha),
    mes: MES.format(fecha).replace('.', ''),
    anio: ANIO.format(fecha),
    hora: HORA.format(fecha),
    diaDeSemana: DIA_DE_SEMANA.format(fecha),
    hace: haceCuanto(fecha, ahora),
  };
}

/**
 * Las sesiones de la historia, en una lista propia (13/11/2026): se llega a cada atencion sin pasar
 * por el turno. Sale del mismo timeline filtrado por origen `SESION`, asi que cada lectura viaja
 * con el motivo de la visita y queda auditada igual que el resto de la historia.
 */
@Component({
  selector: 'app-sesiones-de-la-historia',
  imports: [RouterLink, Ayuda, EstadoVacio],
  templateUrl: './sesiones-de-la-historia.html',
  styleUrl: '../historia-clinica.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SesionesDeLaHistoria {
  private readonly api = inject(HistoriaClinicaApi);

  readonly historiaClinicaId = input.required<number>();
  readonly justificacion = input<Justificacion>(null);
  readonly recargas = input(0);

  protected readonly sesiones = signal<readonly SesionDeLaLista[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly cuenta = computed(() => {
    const n = this.sesiones().length;
    return this.cursor() === null ? String(n) : `${n}+`;
  });

  private pedido: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pedido?.unsubscribe());
    effect(() => {
      this.historiaClinicaId();
      this.justificacion();
      this.recargas();
      untracked(() => this.cargar(null));
    });
  }

  protected verMas(): void {
    const cursor = this.cursor();
    if (cursor !== null) {
      this.cargar(cursor);
    }
  }

  protected reintentar(): void {
    this.cargar(null);
  }

  private cargar(cursor: string | null): void {
    this.cargando.set(true);
    this.error.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api
      .paginaDelTimeline(this.historiaClinicaId(), cursor, SOLO_SESIONES, this.justificacion())
      .subscribe({
        next: (pagina) => {
          const ahora = new Date();
          const nuevas = (pagina.eventos ?? [])
            .map((evento) => aLista(evento, ahora))
            .filter((s): s is SesionDeLaLista => s !== null);
          this.sesiones.update((previas) => (cursor === null ? nuevas : [...previas, ...nuevas]));
          this.cursor.set(pagina.proximoCursor ?? null);
          this.cargando.set(false);
        },
        error: (error: unknown) => {
          this.cargando.set(false);
          this.error.set(traducirErrorHistoria(error).mensaje);
        },
      });
  }
}
