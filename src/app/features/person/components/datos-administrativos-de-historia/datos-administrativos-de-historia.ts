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
import { Observable, Subscription, catchError, forkJoin, map, of, switchMap } from 'rxjs';

import { CasoAdministrativoResponse } from '../../../../api/generated/model/caso-administrativo-response';
import { CasoProfesional } from '../../../../api/generated/model/caso-profesional';
import { DatosAdministrativosDeHistoriaResponse } from '../../../../api/generated/model/datos-administrativos-de-historia-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { HistoriaAdministrativaApi } from '../../services/historia-administrativa-api';
import { fechaEnPalabras } from '../../models/etiquetas-de-ficha';
import { traducirErrorPersona } from '../../models/person-errors';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';

/** Lo que se lee junto: los datos y los nombres con los que se muestran. */
interface Lectura {
  readonly datos: DatosAdministrativosDeHistoriaResponse;
  readonly ofertas: ReadonlyMap<number, string>;
  readonly profesionales: ReadonlyMap<number, string>;
}

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly lectura: Lectura }
  /** 404: la persona no es paciente (o no es de la organizacion). No hay nada que mostrar. */
  | { readonly tipo: 'oculto' }
  | { readonly tipo: 'error'; readonly mensaje: string };

/**
 * Datos administrativos de la historia clinica en el Paciente 360 (matriz §32, "Ver Historia
 * Clinica" del ADMINISTRATIVO: Limitado; AKINE api #109).
 *
 * <p>Responde lo que el mostrador necesita sin abrir lo clinico: si la persona tiene historia,
 * desde cuando, sus casos —numero, estado, oferta, fechas— y quien la atiende hoy. <b>No hay
 * nada clinico en la respuesta</b>, y por eso esta seccion no pide justificacion de acceso: la
 * que la pide es la historia clinica, que es otro modulo y otra pantalla.
 *
 * <p>Los nombres de oferta y profesional se resuelven con las lecturas de la sede actual. Son
 * accesorios: si fallan, o el caso es de otra sede, se muestra el identificador.
 */
@Component({
  imports: [Ayuda],
  selector: 'app-datos-administrativos-de-historia',
  templateUrl: './datos-administrativos-de-historia.html',
  styleUrl: '../../person.css',
})
export class DatosAdministrativosDeHistoria {
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly api = inject(HistoriaAdministrativaApi);
  private readonly contexto = inject(TenantContextStore);

  readonly personaId = input.required<number>();

  protected readonly fecha = (valor: string | undefined | null): string =>
    fechaEnPalabras(valor, this.diaDeLaSede.zona());
  protected readonly estado = signal<Estado>({ tipo: 'cargando' });

  protected readonly lectura = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.lectura : null;
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  private enVuelo: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.enVuelo?.unsubscribe());
    effect(() => {
      const personaId = this.personaId();
      this.contexto.contextEpoch();
      untracked(() => this.cargar(personaId));
    });
  }

  protected reintentar(): void {
    this.cargar(this.personaId());
  }

  protected nombreDeOferta(caso: CasoAdministrativoResponse): string {
    const id = caso.ofertaId;
    if (id === undefined) return 'Sin oferta';
    return this.lectura()?.ofertas.get(id) ?? `Oferta #${id}`;
  }

  protected nombreDeProfesional(miembro: CasoProfesional): string {
    const id = miembro.profesionalMembershipId;
    if (id === undefined) return 'Profesional sin identificar';
    return this.lectura()?.profesionales.get(id) ?? `Profesional #${id}`;
  }

  protected rolEnPalabras(miembro: CasoProfesional): string {
    return miembro.rol === 'RESPONSABLE' ? 'responsable' : 'tratante';
  }

  /** Solo el equipo vigente: quien salio del caso no atiende hoy. */
  protected equipoVigente(caso: CasoAdministrativoResponse): readonly CasoProfesional[] {
    return (caso.equipo ?? []).filter((m) => m.vigente !== false && m.hasta === undefined);
  }

  private cargar(personaId: number): void {
    this.enVuelo?.unsubscribe();
    // Al cambiar de persona o de contexto no queda en pantalla lo de antes.
    this.estado.set({ tipo: 'cargando' });
    this.enVuelo = this.api
      .datos(personaId)
      .pipe(switchMap((datos) => this.conNombres(datos)))
      .subscribe({
        next: (lectura) => this.estado.set({ tipo: 'listo', lectura }),
        error: (error: unknown) => {
          const traducido = traducirErrorPersona(error);
          this.estado.set(
            traducido.causa === 'no-encontrado'
              ? { tipo: 'oculto' }
              : { tipo: 'error', mensaje: traducido.mensaje },
          );
        },
      });
  }

  private conNombres(datos: DatosAdministrativosDeHistoriaResponse): Observable<Lectura> {
    const consultorioId = this.contexto.consultorioId();
    const casos = (datos.casos ?? []).filter(
      (c) => c.ofertaConsultorioId === consultorioId && c.ofertaId !== undefined,
    );
    if (consultorioId === null || casos.length === 0) {
      return of({ datos, ofertas: new Map(), profesionales: new Map() });
    }

    const ofertasIds = [...new Set(casos.map((c) => c.ofertaId as number))];
    const ofertas$ = this.api.ofertasDeLaSede(consultorioId).pipe(
      map((lista) => new Map(lista.map((o) => [o.id ?? -1, o.nombreComercial ?? `#${o.id}`]))),
      catchError(() => of(new Map<number, string>())),
    );
    const profesionales$ = forkJoin(
      ofertasIds.map((ofertaId) =>
        this.api.profesionalesDeOferta(consultorioId, ofertaId).pipe(
          map((r) => r.profesionales ?? []),
          catchError(() => of([])),
        ),
      ),
    ).pipe(
      map((listas) => {
        const nombres = new Map<number, string>();
        for (const p of listas.flat()) {
          if (p.membershipId !== undefined && p.nombre) nombres.set(p.membershipId, p.nombre);
        }
        return nombres;
      }),
    );
    return forkJoin({ ofertas: ofertas$, profesionales: profesionales$ }).pipe(
      map(({ ofertas, profesionales }) => ({ datos, ofertas, profesionales })),
    );
  }
}
