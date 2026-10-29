import {
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
import { Migas } from '../../../../shared/components/migas/migas';
import { Observable, Subscription, forkJoin } from 'rxjs';

import { CasoClinico } from '../../../../api/generated/model/caso-clinico';
import { CasoEvento } from '../../../../api/generated/model/caso-evento';
import { IntegranteDelEquipoRolEnum } from '../../../../api/generated/model/integrante-del-equipo';
import { ProfesionalHabilitado } from '../../../../api/generated/model/profesional-habilitado';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { PedidoDeMotivo } from '../../components/pedido-de-motivo';
import {
  ESTADOS_DE_CASO,
  EVENTOS_DE_CASO,
  ROLES_EN_CASO,
  esVigente,
} from '../../models/etiquetas-de-casos';
import { fechaYHora, rotulo } from '../../models/etiquetas-de-historia';
import { SedeClinicaApi } from '../../services/sede-clinica-api';
import { VisitaClinica } from '../../services/visita-clinica';
import { CasosApi } from '../casos-api';
import { ErrorCaso, errorDeCausaCaso, traducirErrorCaso } from '../casos-errors';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

interface Integrante {
  readonly membershipId: number;
  readonly rol: IntegranteDelEquipoRolEnum;
}

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'requiere-justificacion' }
  | { readonly tipo: 'listo' }
  | { readonly tipo: 'error'; readonly error: ErrorCaso };

/** Lo que esta en vuelo, para deshabilitar solo lo que corresponde y anunciar el resultado. */
type Operacion = 'editar' | 'equipo' | 'cerrar' | 'reabrir';

/**
 * Un Caso Clinico: detalle, edicion, equipo, cierre y reapertura con motivo, e historial (D-b,
 * RF-M10-003..006).
 *
 * <p><b>Toda escritura manda la version leida.</b> Si otra pestaña cambio el caso en el medio, el
 * backend responde `concurrent-modification` y la pantalla ofrece releer: nunca pisa en silencio.
 * Desde `appKine-api` #109 el cambio de equipo devuelve la version nueva, asi que dos cambios
 * seguidos desde esta misma pantalla pasan sin releer.
 *
 * <p>El caso es contenido clinico: cada lectura lleva el motivo de la visita, y si se abre por
 * enlace directo sin relacion asistencial, la pantalla lo pide antes de mostrar nada.
 */
@Component({
  selector: 'app-caso-detalle-page',
  imports: [CabeceraDePagina, Migas, Ayuda, RouterLink, PedidoDeMotivo],
  templateUrl: './caso-detalle-page.html',
  styleUrl: '../../pages/historia-clinica/historia-clinica.css',
})
export class CasoDetallePage {
  private readonly api = inject(CasosApi);
  private readonly sede = inject(SedeClinicaApi);
  private readonly contexto = inject(TenantContextStore);
  protected readonly visita = inject(VisitaClinica);

  readonly casoId = input.required<string>();

  protected readonly fechaYHora = fechaYHora;
  protected readonly roles = Object.values(IntegranteDelEquipoRolEnum);
  protected readonly rotuloDeRol = (rol: string | undefined) => rotulo(ROLES_EN_CASO, rol);
  protected readonly rotuloDeEvento = (tipo: string | undefined) => rotulo(EVENTOS_DE_CASO, tipo);

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly caso = signal<CasoClinico | null>(null);
  protected readonly eventos = signal<readonly CasoEvento[]>([]);
  /** Desde 0.107.0 el caso trae el nombre, resuelto contra la sede de la oferta. */
  protected readonly nombreDeOferta = computed(() => {
    const caso = this.caso();
    if (caso?.ofertaNombre) return caso.ofertaNombre;
    return caso?.ofertaId === undefined ? 'Sin oferta' : `Oferta #${caso.ofertaId}`;
  });
  protected readonly habilitados = signal<readonly ProfesionalHabilitado[]>([]);

  protected readonly enVuelo = signal<Operacion | null>(null);
  protected readonly errorDeOperacion = signal<ErrorCaso | null>(null);
  protected readonly aviso = signal('');

  // Edicion
  protected readonly diagnostico = signal('');
  protected readonly objetivo = signal('');
  // Equipo: copia de trabajo, se guarda entera (el PUT es un reemplazo completo).
  protected readonly equipo = signal<readonly Integrante[]>([]);
  protected readonly nuevoIntegrante = signal<number | null>(null);
  protected readonly nuevoRol = signal<IntegranteDelEquipoRolEnum>(
    IntegranteDelEquipoRolEnum.TRATANTE,
  );
  // Cierre y reapertura
  protected readonly motivo = signal('');
  protected readonly intentoMotivo = signal(false);

  protected readonly activo = computed(() => this.caso()?.estado === 'ACTIVO');
  protected readonly estadoEnPalabras = computed(() =>
    rotulo(ESTADOS_DE_CASO, this.caso()?.estado),
  );
  protected readonly faltaMotivo = computed(() => this.motivo().trim() === '');
  protected readonly faltaDiagnostico = computed(() => this.diagnostico().trim() === '');

  /** Los habilitados que todavia no estan en el equipo: no se puede sumar dos veces al mismo. */
  protected readonly candidatos = computed(() => {
    const enEquipo = new Set(this.equipo().map((i) => i.membershipId));
    return this.habilitados().filter(
      (p) => p.membershipId !== undefined && !p.deletedAt && !enEquipo.has(p.membershipId),
    );
  });

  /** ¿La copia de trabajo difiere de lo guardado? Sin cambios no hay nada que mandar. */
  protected readonly equipoCambiado = computed(() => {
    const guardado = this.integrantesDe(this.caso());
    const actual = this.equipo();
    return (
      guardado.length !== actual.length ||
      guardado.some((g, i) => g.membershipId !== actual[i].membershipId || g.rol !== actual[i].rol)
    );
  });

  private pedido: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pedido?.unsubscribe());

    effect(() => {
      this.casoId();
      this.visita.motivo();
      this.contexto.contextEpoch();
      untracked(() => this.cargar());
    });
  }

  /**
   * El nombre de un integrante: el que trae el caso (0.107.0, resuelto por la membership aunque ya
   * no este habilitado) y, para alguien recien sumado en la copia de trabajo, el de la habilitacion
   * de donde se lo eligio.
   */
  protected nombreDe(membershipId: number | undefined): string {
    if (membershipId === undefined) return 'Profesional sin identificar';
    const delCaso = this.caso()?.equipo?.find((m) => m.profesionalMembershipId === membershipId);
    const habilitado = this.habilitados().find((p) => p.membershipId === membershipId);
    return delCaso?.profesionalNombre ?? habilitado?.nombre ?? `Profesional #${membershipId}`;
  }

  protected releer(): void {
    this.cargar();
  }

  // --- Edicion ---------------------------------------------------------------------------

  protected guardarEdicion(): void {
    const caso = this.caso();
    if (caso?.id === undefined || this.faltaDiagnostico()) return;
    const objetivo = this.objetivo().trim();
    this.ejecutar(
      'editar',
      this.api.editar(
        caso.id,
        {
          diagnosticoPresuntivo: this.diagnostico().trim(),
          ...(objetivo === '' ? {} : { objetivoTerapeutico: objetivo }),
          expectedVersion: caso.version ?? 0,
        },
        this.visita.motivo(),
      ),
      'Se guardaron el diagnostico y el objetivo.',
    );
  }

  // --- Equipo ----------------------------------------------------------------------------

  protected elegirNuevoIntegrante(valor: string): void {
    this.nuevoIntegrante.set(valor === '' ? null : Number(valor));
  }

  protected elegirNuevoRol(valor: string): void {
    this.nuevoRol.set(valor as IntegranteDelEquipoRolEnum);
  }

  protected sumar(): void {
    const membershipId = this.nuevoIntegrante();
    if (membershipId === null) return;
    this.equipo.update((actual) => [...actual, { membershipId, rol: this.nuevoRol() }]);
    this.nuevoIntegrante.set(null);
  }

  protected quitar(membershipId: number): void {
    this.equipo.update((actual) => actual.filter((i) => i.membershipId !== membershipId));
  }

  protected cambiarRol(membershipId: number, rol: string): void {
    this.equipo.update((actual) =>
      actual.map((i) =>
        i.membershipId === membershipId ? { ...i, rol: rol as IntegranteDelEquipoRolEnum } : i,
      ),
    );
  }

  protected guardarEquipo(): void {
    const caso = this.caso();
    if (caso?.id === undefined) return;
    this.ejecutar(
      'equipo',
      this.api.cambiarEquipo(
        caso.id,
        this.equipo().map((i) => ({ profesionalMembershipId: i.membershipId, rol: i.rol })),
        caso.version ?? 0,
        this.visita.motivo(),
      ),
      'Se guardo el equipo del caso.',
    );
  }

  // --- Cierre y reapertura ---------------------------------------------------------------

  protected cerrarOReabrir(): void {
    this.intentoMotivo.set(true);
    const caso = this.caso();
    if (caso?.id === undefined || this.faltaMotivo()) return;
    const motivo = this.motivo().trim();
    const version = caso.version ?? 0;
    if (this.activo()) {
      this.ejecutar(
        'cerrar',
        this.api.cerrar(caso.id, motivo, version, this.visita.motivo()),
        'El caso quedo cerrado. Sigue en la historia y se puede reabrir con motivo.',
      );
    } else {
      this.ejecutar(
        'reabrir',
        this.api.reabrir(caso.id, motivo, version, this.visita.motivo()),
        'El caso volvio a estar activo.',
      );
    }
  }

  // ---------------------------------------------------------------------------------------

  private ejecutar(operacion: Operacion, pedido: Observable<CasoClinico>, exito: string): void {
    this.enVuelo.set(operacion);
    this.errorDeOperacion.set(null);
    this.aviso.set('');
    pedido.subscribe({
      next: (caso) => {
        this.enVuelo.set(null);
        this.mostrar(caso);
        this.motivo.set('');
        this.intentoMotivo.set(false);
        this.aviso.set(exito);
        this.cargarEventos(caso.id);
      },
      error: (error: unknown) => {
        this.enVuelo.set(null);
        const traducido = traducirErrorCaso(error);
        if (traducido.causa === 'requiere-justificacion') {
          this.estado.set({ tipo: 'requiere-justificacion' });
          return;
        }
        this.errorDeOperacion.set(traducido);
      },
    });
  }

  private cargar(): void {
    if (this.visita.personaId() === null) return;
    const casoId = Number(this.casoId());
    if (!Number.isSafeInteger(casoId) || casoId <= 0) {
      this.estado.set({ tipo: 'error', error: errorDeCausaCaso('no-encontrado') });
      return;
    }
    this.estado.set({ tipo: 'cargando' });
    this.errorDeOperacion.set(null);
    this.aviso.set('');
    this.pedido?.unsubscribe();
    const motivo = this.visita.motivo();
    this.pedido = forkJoin({
      caso: this.api.ver(casoId, motivo),
      eventos: this.api.eventos(casoId, motivo),
    }).subscribe({
      next: ({ caso, eventos }) => {
        this.mostrar(caso);
        this.eventos.set(eventos);
        this.estado.set({ tipo: 'listo' });
        this.cargarSede(caso);
      },
      error: (error: unknown) => {
        const traducido = traducirErrorCaso(error);
        this.caso.set(null);
        this.estado.set(
          traducido.causa === 'requiere-justificacion'
            ? { tipo: 'requiere-justificacion' }
            : { tipo: 'error', error: traducido },
        );
      },
    });
  }

  private mostrar(caso: CasoClinico): void {
    this.caso.set(caso);
    this.diagnostico.set(caso.diagnosticoPresuntivo ?? '');
    this.objetivo.set(caso.objetivoTerapeutico ?? '');
    this.equipo.set(this.integrantesDe(caso));
  }

  private cargarEventos(casoId: number | undefined): void {
    if (casoId === undefined) return;
    this.api.eventos(casoId, this.visita.motivo()).subscribe({
      next: (eventos) => this.eventos.set(eventos),
      error: () => undefined, // El historial es accesorio: el caso ya se mostro actualizado.
    });
  }

  /**
   * Los habilitados de la oferta, de donde salen los candidatos para sumar al equipo. Accesorios:
   * si fallan, no se ofrece a nadie y el equipo guardado se sigue viendo con sus nombres.
   */
  private cargarSede(caso: CasoClinico): void {
    const consultorioId = this.contexto.consultorioId();
    const ofertaId = caso.ofertaId;
    this.habilitados.set([]);
    if (consultorioId === null || ofertaId === undefined) return;
    if (caso.ofertaConsultorioId !== undefined && caso.ofertaConsultorioId !== consultorioId) {
      return; // Caso de otra sede: sus habilitaciones no son de esta.
    }
    this.sede
      .profesionales$(consultorioId, ofertaId)
      .subscribe((lista) => this.habilitados.set(lista));
  }

  private integrantesDe(caso: CasoClinico | null): readonly Integrante[] {
    return (caso?.equipo ?? [])
      .filter(esVigente)
      .filter((m) => m.profesionalMembershipId !== undefined)
      .map((m) => ({
        membershipId: m.profesionalMembershipId as number,
        rol: (m.rol ?? 'TRATANTE') as IntegranteDelEquipoRolEnum,
      }));
  }
}
