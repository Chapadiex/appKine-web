import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';

import { Clase } from '../../../../api/generated/model/clase';
import { InstructoresDeClase } from '../../../../api/generated/model/instructores-de-clase';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ErrorActividad, traducirErrorActividad } from '../../models/actividad-errors';
import { ActivityApi } from '../../services/activity-api';

interface Candidato {
  readonly membershipId: number;
  readonly nombre: string;
}

/**
 * Instructores de una clase: el principal y los adicionales (DP-38, contrato 0.134.0).
 *
 * <p>Los honorarios por clase se reparten <b>en partes iguales</b> entre todos los instructores, asi
 * que sumar o quitar un adicional cambia lo que cobra cada uno. El adicional <b>no ocupa agenda</b>:
 * la exclusion de turnos y clases sigue mirando solo al principal, y la pantalla lo dice.
 *
 * <p>Leer exige `clase:read`; reemplazar, `clase:manage`. El reemplazo es de la lista COMPLETA.
 * Una clase con honorarios liquidados responde 409 `clase-con-honorarios-liquidados`: se explica
 * que la salida es anular el egreso de esa liquidacion.
 */
@Component({
  selector: 'app-instructores-de-clase',
  templateUrl: './instructores-de-clase.html',
  styleUrl: '../../activity.css',
})
export class InstructoresDeClaseComponent {
  private readonly api = inject(ActivityApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly clase = input.required<Clase>();
  /** `clase:manage` y una clase no cancelada. UX: el backend decide igual. */
  readonly puedeGestionar = input(false);

  protected readonly instructores = signal<InstructoresDeClase | null>(null);
  protected readonly errorDeLectura = signal<ErrorActividad | null>(null);
  protected readonly editando = signal(false);
  protected readonly candidatos = signal<readonly Candidato[] | null>(null);
  protected readonly elegidos = signal<ReadonlySet<number>>(new Set());
  protected readonly enviando = signal(false);
  protected readonly errorDeAccion = signal<ErrorActividad | null>(null);
  protected readonly aviso = signal('');

  protected readonly adicionales = computed(() => this.instructores()?.adicionales ?? []);
  /** Sin el principal: no puede ser adicional de su propia clase. */
  protected readonly opciones = computed(() => {
    const principal = this.instructores()?.principalMembershipId;
    const actuales = this.adicionales();
    const lista = [...(this.candidatos() ?? [])].filter((c) => c.membershipId !== principal);
    // Un adicional vigente que ya no figura entre los elegibles se sigue mostrando: quitarlo de la
    // vista lo quitaria de la clase sin que nadie lo decida.
    for (const actual of actuales) {
      if (
        actual.membershipId !== undefined &&
        !lista.some((c) => c.membershipId === actual.membershipId)
      ) {
        lista.push({
          membershipId: actual.membershipId,
          nombre: actual.nombre || `Profesional #${actual.membershipId}`,
        });
      }
    }
    return lista;
  });
  protected readonly nombresDeAdicionales = computed(() => {
    const nombres = this.adicionales().map((a) => a.nombre || `Profesional #${a.membershipId}`);
    return nombres.length === 0 ? 'Ninguno' : nombres.join(', ');
  });
  protected readonly cantidad = computed(
    () =>
      (this.instructores()?.principalMembershipId === undefined ? 0 : 1) +
      this.adicionales().length,
  );

  constructor() {
    effect(() => {
      const clase = this.clase();
      this.tenant.contextEpoch();
      untracked(() => {
        this.editando.set(false);
        this.aviso.set('');
        this.errorDeAccion.set(null);
        this.cargar(clase);
      });
    });
  }

  protected cargar(clase = this.clase()): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null || clase.id === undefined) {
      return;
    }
    this.errorDeLectura.set(null);
    this.api.instructores(consultorioId, clase.id).subscribe({
      next: (respuesta) => this.instructores.set(respuesta),
      error: (error: unknown) => {
        this.instructores.set(null);
        this.errorDeLectura.set(traducirErrorActividad(error));
      },
    });
  }

  protected nombreDelPrincipal(): string {
    const actual = this.instructores();
    if (actual?.principalMembershipId === undefined) {
      return 'Sin instructor principal';
    }
    return actual.principalNombre || `Profesional #${actual.principalMembershipId}`;
  }

  protected abrir(): void {
    const consultorioId = this.tenant.consultorioId();
    const ofertaId = this.clase().ofertaId;
    this.elegidos.set(
      new Set(
        this.adicionales()
          .map((a) => a.membershipId)
          .filter((id): id is number => id !== undefined),
      ),
    );
    this.errorDeAccion.set(null);
    this.aviso.set('');
    this.editando.set(true);
    this.candidatos.set(null);
    if (consultorioId !== null && ofertaId !== undefined) {
      this.api
        .instructoresElegibles(this.tenant.organizationId(), consultorioId, ofertaId)
        .subscribe((lista) => this.candidatos.set(lista));
    } else {
      this.candidatos.set([]);
    }
    this.enfocarDespues('#instructores-titulo-panel');
  }

  protected cerrar(): void {
    this.editando.set(false);
    this.enfocarDespues('#boton-instructores');
  }

  protected elegido(membershipId: number): boolean {
    return this.elegidos().has(membershipId);
  }

  protected alternar(membershipId: number, marcado: boolean): void {
    const nuevos = new Set(this.elegidos());
    if (marcado) {
      nuevos.add(membershipId);
    } else {
      nuevos.delete(membershipId);
    }
    this.elegidos.set(nuevos);
  }

  protected guardar(): void {
    const consultorioId = this.tenant.consultorioId();
    const claseId = this.clase().id;
    if (consultorioId === null || claseId === undefined || this.enviando()) {
      return;
    }
    const adicionales = [...this.elegidos()].sort((a, b) => a - b);
    this.enviando.set(true);
    this.errorDeAccion.set(null);
    this.api.reemplazarInstructores(consultorioId, claseId, adicionales).subscribe({
      next: (respuesta) => {
        this.enviando.set(false);
        this.instructores.set(respuesta);
        this.editando.set(false);
        const adicionales = (respuesta.adicionales ?? []).length;
        const total = adicionales + (respuesta.principalMembershipId === undefined ? 0 : 1);
        this.aviso.set(
          adicionales === 0
            ? 'La clase quedo sin instructores adicionales.'
            : `La clase quedo con ${total} instructores: los honorarios se reparten en partes ` +
                'iguales.',
        );
        this.enfocarDespues('#aviso-instructores');
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.errorDeAccion.set(traducirErrorActividad(error));
      },
    });
  }

  private enfocarDespues(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
}
