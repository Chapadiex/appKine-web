import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subject, Subscription, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Icono } from '../../../../shared/components/icono/icono';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { ClinicalApi } from '../../services/clinical-api';

const FECHA = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });

interface Tarjeta {
  readonly id: number;
  readonly nombre: string;
  readonly iniciales: string;
  readonly documento: string | null;
  readonly edad: string | null;
  readonly contacto: string | null;
  readonly pacienteDesde: string | null;
}

const ROTULO_DOCUMENTO: Readonly<Record<string, string>> = {
  DNI: 'DNI',
  PASAPORTE: 'Pasaporte',
  LC: 'Libreta cívica',
  LE: 'Libreta de enrolamiento',
  CI: 'Cédula',
  OTRO: 'Documento',
};

function edadDe(fechaNacimiento: string | undefined, hoy: Date): string | null {
  if (!fechaNacimiento) return null;
  const [anio, mes, dia] = fechaNacimiento.split('-').map(Number);
  if (!anio || !mes || !dia) return null;
  let edad = hoy.getFullYear() - anio;
  if (hoy.getMonth() + 1 < mes || (hoy.getMonth() + 1 === mes && hoy.getDate() < dia)) edad--;
  return edad >= 0 ? `${edad} ${edad === 1 ? 'año' : 'años'}` : null;
}

function aTarjeta(persona: PersonaResponse, hoy: Date): Tarjeta | null {
  if (persona.id === undefined) return null;
  const apellido = persona.apellido?.trim() ?? '';
  const nombre = persona.nombre?.trim() ?? '';
  const desde = persona.perfilActivadoEn ? new Date(persona.perfilActivadoEn) : null;
  return {
    id: persona.id,
    nombre: [apellido, nombre].filter(Boolean).join(', ') || 'Sin nombre',
    iniciales: ((apellido[0] ?? '') + (nombre[0] ?? '')).toUpperCase() || '?',
    documento: persona.numeroDocumento
      ? `${ROTULO_DOCUMENTO[persona.tipoDocumento ?? ''] ?? persona.tipoDocumento ?? ''} ${persona.numeroDocumento}`.trim()
      : null,
    edad: edadDe(persona.fechaNacimiento, hoy),
    contacto: persona.telefono || persona.email || null,
    pacienteDesde: desde && !Number.isNaN(desde.getTime()) ? FECHA.format(desde) : null,
  };
}

/**
 * Historias clinicas: el buscador de pacientes que lleva a su historia y a sus sesiones sin pasar
 * por un turno (13/11/2026). Lista solo personas con perfil de paciente vigente; abrir la historia
 * es la pantalla de siempre, que pide el motivo si hace falta y audita la lectura.
 */
@Component({
  selector: 'app-historias-clinicas-page',
  imports: [RouterLink, Ayuda, CabeceraDePagina, EstadoVacio, Icono, Paginacion],
  templateUrl: './historias-clinicas-page.html',
  styleUrl: './historias-clinicas-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoriasClinicasPage {
  private readonly api = inject(ClinicalApi);
  private readonly tenant = inject(TenantContextStore);

  protected readonly texto = signal('');
  protected readonly pagina = signal(0);
  protected readonly porPagina = signal(12);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly tarjetas = signal<readonly Tarjeta[]>([]);
  protected readonly total = signal(0);
  protected readonly totalPaginas = signal(0);

  protected readonly resumen = computed(() => {
    const n = this.total();
    if (this.texto().trim() !== '') {
      return n === 1 ? '1 paciente encontrado' : `${n} pacientes encontrados`;
    }
    return n === 1 ? '1 paciente' : `${n} pacientes`;
  });

  private readonly escritura = new Subject<string>();
  private pedido: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pedido?.unsubscribe());
    this.escritura.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((texto) => {
      this.texto.set(texto);
      this.pagina.set(0);
    });
    effect(() => {
      this.texto();
      this.pagina();
      this.porPagina();
      this.tenant.contextEpoch();
      untracked(() => this.cargar());
    });
  }

  protected escribir(texto: string): void {
    this.escritura.next(texto);
  }

  protected limpiar(): void {
    this.texto.set('');
    this.pagina.set(0);
  }

  protected irAPagina(numero: number): void {
    this.pagina.set(numero);
  }

  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.pagina.set(0);
  }

  protected reintentar(): void {
    this.cargar();
  }

  private cargar(): void {
    this.cargando.set(true);
    this.error.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api
      .buscarPacientes(this.texto(), this.pagina(), this.porPagina())
      .subscribe({
        next: (respuesta) => {
          const hoy = new Date();
          this.tarjetas.set(
            (respuesta.content ?? [])
              .map((p) => aTarjeta(p, hoy))
              .filter((t): t is Tarjeta => t !== null),
          );
          this.total.set(respuesta.totalElements ?? 0);
          this.totalPaginas.set(respuesta.totalPages ?? 0);
          this.cargando.set(false);
        },
        error: (error: unknown) => {
          this.cargando.set(false);
          const estado = (error as { status?: number })?.status;
          this.error.set(
            estado === 403
              ? 'No tenés permiso para consultar el padrón de pacientes. Pedíselo a quien administra el centro.'
              : 'No pudimos traer los pacientes. Revisá la conexión y volvé a intentar.',
          );
        },
      });
  }
}
