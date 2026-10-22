import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { CasoClinico } from '../../../../api/generated/model/caso-clinico';
import { CasoProfesional } from '../../../../api/generated/model/caso-profesional';
import { IntegranteDelEquipoRolEnum } from '../../../../api/generated/model/integrante-del-equipo';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { ProfesionalHabilitado } from '../../../../api/generated/model/profesional-habilitado';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ESTADOS_DE_CASO, ROLES_EN_CASO, esVigente } from '../../models/etiquetas-de-casos';
import { fechaYHora, rotulo } from '../../models/etiquetas-de-historia';
import { SedeClinicaApi, ofertaElegible } from '../../services/sede-clinica-api';
import { VisitaClinica } from '../../services/visita-clinica';
import { CasosApi } from '../casos-api';
import { ErrorCaso, traducirErrorCaso } from '../casos-errors';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

/**
 * Los casos de una Historia Clinica y el alta compacta (D-b, RF-M10-001/002).
 *
 * <p>HC ≠ Caso: la historia es de la persona y un caso es UN problema terapeutico dentro de ella.
 * Por eso esta seccion vive en la pantalla de la historia, pero cada caso se abre en su propia
 * pantalla. Activos primero y despues los cerrados: un caso cerrado no se borra, se sigue leyendo.
 *
 * <p>El alta pide lo minimo que el contrato exige —oferta y diagnostico presuntivo— y, opcional, el
 * objetivo y el profesional responsable. Las ofertas y los profesionales salen de la sede: nadie
 * escribe un identificador.
 */
@Component({
  selector: 'app-casos-de-la-historia',
  imports: [Ayuda, RouterLink],
  templateUrl: './casos-de-la-historia.html',
  styleUrl: '../../pages/historia-clinica/historia-clinica.css',
})
export class CasosDeLaHistoria {
  private readonly api = inject(CasosApi);
  private readonly sede = inject(SedeClinicaApi);
  private readonly contexto = inject(TenantContextStore);
  private readonly router = inject(Router);
  protected readonly visita = inject(VisitaClinica);

  readonly historiaClinicaId = input.required<number>();
  /** Se abrio un caso: la historia relee lo que depende de los casos (el filtro del timeline). */
  readonly cambiaron = output<void>();

  protected readonly fechaYHora = fechaYHora;

  protected readonly casos = signal<readonly CasoClinico[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal<ErrorCaso | null>(null);
  private readonly ofertas = signal<readonly OfertaResponse[]>([]);
  protected readonly profesionales = signal<readonly ProfesionalHabilitado[]>([]);

  protected readonly activos = computed(() => this.casos().filter((c) => c.estado !== 'CERRADO'));
  protected readonly cerrados = computed(() => this.casos().filter((c) => c.estado === 'CERRADO'));
  protected readonly elegibles = computed(() => this.ofertas().filter(ofertaElegible));

  // --- Alta ---------------------------------------------------------------------------
  protected readonly ofertaId = signal<number | null>(null);
  protected readonly diagnostico = signal('');
  protected readonly objetivo = signal('');
  protected readonly responsableId = signal<number | null>(null);
  protected readonly intento = signal(false);
  protected readonly guardando = signal(false);
  protected readonly errorDeAlta = signal<ErrorCaso | null>(null);
  /** Los casos que el backend nombro como posibles duplicados: se ofrecen para abrirlos. */
  protected readonly candidatos = signal<readonly CasoClinico[]>([]);

  protected readonly faltaOferta = computed(() => this.ofertaId() === null);
  protected readonly faltaDiagnostico = computed(() => this.diagnostico().trim() === '');

  private pedido: Subscription | null = null;
  private pedidoDeProfesionales: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pedido?.unsubscribe();
      this.pedidoDeProfesionales?.unsubscribe();
    });

    effect(() => {
      const historia = this.historiaClinicaId();
      this.visita.motivo();
      this.contexto.contextEpoch();
      untracked(() => this.cargar(historia));
    });

    effect(() => {
      const consultorioId = this.contexto.consultorioId();
      untracked(() => {
        this.ofertas.set([]);
        if (consultorioId !== null) {
          this.sede.ofertas$(consultorioId).subscribe((lista) => this.ofertas.set(lista));
        }
      });
    });
  }

  /**
   * El nombre lo trae el caso desde 0.107.0 (`appKine-api` #132), resuelto contra la sede de la
   * oferta: sirve tambien para un caso de otra sede, que el listado de esta no conoce.
   */
  protected nombreDeOferta(caso: CasoClinico): string {
    if (caso.ofertaNombre) return caso.ofertaNombre;
    return caso.ofertaId === undefined ? 'Sin oferta' : `Oferta #${caso.ofertaId}`;
  }

  protected estadoDe(caso: CasoClinico): string {
    return rotulo(ESTADOS_DE_CASO, caso.estado);
  }

  protected equipoDe(caso: CasoClinico): string {
    const vigentes = (caso.equipo ?? []).filter(esVigente);
    if (vigentes.length === 0) return 'Sin equipo asignado';
    return vigentes.map((m) => `${this.nombreDe(m)} (${rotulo(ROLES_EN_CASO, m.rol)})`).join(', ');
  }

  protected elegirOferta(valor: string): void {
    const ofertaId = valor === '' ? null : Number(valor);
    this.ofertaId.set(ofertaId);
    this.responsableId.set(null);
    this.profesionales.set([]);
    const consultorioId = this.contexto.consultorioId();
    if (ofertaId === null || consultorioId === null) return;
    this.pedidoDeProfesionales?.unsubscribe();
    this.pedidoDeProfesionales = this.sede
      .profesionales$(consultorioId, ofertaId)
      .subscribe((lista) => this.profesionales.set(lista.filter((p) => !p.deletedAt)));
  }

  protected elegirResponsable(valor: string): void {
    this.responsableId.set(valor === '' ? null : Number(valor));
  }

  protected abrir(confirmaPosibleDuplicado: boolean): void {
    this.intento.set(true);
    const ofertaId = this.ofertaId();
    if (ofertaId === null || this.faltaDiagnostico()) return;

    const objetivo = this.objetivo().trim();
    const responsable = this.responsableId();
    this.guardando.set(true);
    this.errorDeAlta.set(null);
    this.api
      .abrir(
        this.historiaClinicaId(),
        {
          ofertaId,
          diagnosticoPresuntivo: this.diagnostico().trim(),
          ...(objetivo === '' ? {} : { objetivoTerapeutico: objetivo }),
          ...(responsable === null
            ? {}
            : {
                equipo: [
                  {
                    profesionalMembershipId: responsable,
                    rol: IntegranteDelEquipoRolEnum.RESPONSABLE,
                  },
                ],
              }),
          ...(confirmaPosibleDuplicado ? { confirmaPosibleDuplicado: true } : {}),
        },
        this.visita.motivo(),
      )
      .subscribe({
        next: (caso) => {
          this.guardando.set(false);
          this.cambiaron.emit();
          if (caso.id !== undefined) {
            this.router.navigateByUrl(this.visita.rutaCaso(caso.id));
          }
        },
        error: (error: unknown) => {
          this.guardando.set(false);
          const traducido = traducirErrorCaso(error);
          this.errorDeAlta.set(traducido);
          this.candidatos.set(
            traducido.causa === 'posible-duplicado' ? this.candidatosDe(error) : [],
          );
        },
      });
  }

  protected reintentar(): void {
    this.cargar(this.historiaClinicaId());
  }

  private cargar(historiaClinicaId: number): void {
    this.cargando.set(true);
    this.error.set(null);
    this.pedido?.unsubscribe();
    this.pedido = this.api.listar(historiaClinicaId, this.visita.motivo()).subscribe({
      next: (casos) => {
        this.casos.set(casos);
        this.cargando.set(false);
      },
      error: (error: unknown) => {
        this.casos.set([]);
        this.cargando.set(false);
        this.error.set(traducirErrorCaso(error));
      },
    });
  }

  /**
   * El nombre viene en el integrante desde 0.107.0, resuelto por la membership en la organizacion:
   * sirve aunque el profesional ya no este habilitado. Antes se pedian las habilitaciones de cada
   * oferta solo para esto.
   */
  private nombreDe(integrante: CasoProfesional): string {
    if (integrante.profesionalNombre) return integrante.profesionalNombre;
    const id = integrante.profesionalMembershipId;
    return id === undefined ? 'Profesional sin identificar' : `Profesional #${id}`;
  }

  private candidatosDe(error: unknown): readonly CasoClinico[] {
    const ids = error instanceof AkineHttpError ? error.extension('candidatos') : undefined;
    if (!Array.isArray(ids)) return [];
    return this.casos().filter((c) => c.id !== undefined && ids.includes(c.id));
  }
}
