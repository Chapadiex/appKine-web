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
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { HabilitacionesResponse } from '../../../../api/generated/model/habilitaciones-response';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import {
  ErrorActividad,
  errorSinContextoDeActividad,
  traducirErrorActividad,
} from '../../models/actividad-errors';
import { OpcionDeEspacio, instanteDesdeHoraDeSede } from '../../models/clases';
import { RUTA_CLASES, rutaDeClase } from '../../models/rutas-de-clases';
import { ActivityApi } from '../../services/activity-api';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

/** Un profesional elegible: el id que viaja es el de su membership. */
export interface OpcionDeProfesional {
  readonly membershipId: number;
  readonly nombre: string;
}

const HORA_POR_DEFECTO = '09:00';
const DURACION_POR_DEFECTO = 60;

/**
 * Programar una clase (M28, RF-M28-001, CA-M28-001-06, AKINE-08.01).
 *
 * <p>Una clase sobre una oferta <b>GRUPAL</b>: el selector solo ofrece esas, porque cualquier otra
 * termina en `clase-no-programable`. El backend revalida todo lo demas —profesional habilitado y
 * atendiendo, cupo que entre en la oferta y en el box, y que ni el profesional ni el box tengan un
 * turno u otra clase que se cruce—, y cada rechazo vuelve con su tipo.
 *
 * <p><b>No hay recurrencia</b>: el contrato programa una clase por vez. <b>El box es opcional</b>
 * (contrato 0.102.0): sin elegirlo, si la oferta lo requiere el backend toma uno habilitado y
 * libre; elegido, el backend valida ese y no cae a otro.
 *
 * <p>Fecha y hora son de pared de la SEDE y viajan como instante UTC. La clave de idempotencia es
 * una por intento: un doble click o un reintento por red devuelven la misma clase.
 */
@Component({
  selector: 'app-alta-de-clase-page',
  imports: [CabeceraDePagina, Ayuda, ReactiveFormsModule, RouterLink, Alerta],
  templateUrl: './alta-de-clase-page.html',
  styleUrl: '../../activity.css',
})
export class AltaDeClasePage {
  protected readonly RUTA_CLASES = RUTA_CLASES;

  private readonly api = inject(ActivityApi);
  private readonly tenant = inject(TenantContextStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosStore);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** `?fecha=YYYY-MM-DD`: el dia desde el que se llego. */
  readonly fecha = input('', { transform: (valor: string | undefined) => valor ?? '' });

  protected readonly formulario = this.fb.group({
    ofertaId: ['', Validators.required],
    profesionalId: [''],
    espacioId: [''],
    fecha: [this.diaDeLaSede.hoy(), Validators.required],
    horaInicio: [HORA_POR_DEFECTO, Validators.required],
    horaFin: [sumarMinutos(HORA_POR_DEFECTO, DURACION_POR_DEFECTO), Validators.required],
    capacidad: [10, [Validators.required, Validators.min(1)]],
    titulo: [''],
  });

  protected readonly ofertas = signal<readonly OfertaResponse[] | null>(null);
  protected readonly profesionales = signal<readonly OpcionDeProfesional[]>([]);
  protected readonly espacios = signal<readonly OpcionDeEspacio[]>([]);
  protected readonly ofertaElegida = signal<OfertaResponse | null>(null);
  protected readonly enviando = signal(false);
  protected readonly error = signal<ErrorActividad | null>(null);
  /** Las ofertas no se pudieron leer: sin ellas no hay clase que programar. */
  protected readonly errorDeOfertas = signal<ErrorActividad | null>(null);
  /** La hora de fin no es posterior a la de inicio: se dice en el campo de fin (UX-12). */
  protected readonly finAntesDeInicio = signal(false);
  protected readonly intentado = signal(false);

  /**
   * Cual de los datos choca con algo que ya existe (UX-12): se muestra pegado a esos campos y no
   * como error general del formulario.
   */
  protected readonly conflicto = computed<'oferta' | 'horario' | 'cupo' | null>(() => {
    switch (this.error()?.causa) {
      case 'clase-no-programable':
        return 'oferta';
      case 'recurso-ocupado':
      case 'horario-no-disponible':
        return 'horario';
      case 'clase-capacidad-no-admitida':
        return 'cupo';
      default:
        return null;
    }
  });

  protected readonly exigeProfesional = computed(
    () => this.ofertaElegida()?.requiereProfesional ?? false,
  );

  private clave = nuevaClaveDeIntento();

  constructor() {
    const { fecha } = this.formulario.controls;
    this.diaDeLaSede.alinear(
      () => fecha.value,
      (hoy) => fecha.setValue(hoy),
    );
    effect(() => {
      const deLaUrl = this.fecha();
      untracked(() => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(deLaUrl)) {
          fecha.setValue(deLaUrl);
        }
      });
    });
    effect(() => {
      this.tenant.contextEpoch();
      untracked(() => {
        this.formulario.controls.ofertaId.setValue('');
        this.ofertaElegida.set(null);
        this.profesionales.set([]);
        this.espacios.set([]);
        this.cargarOfertas();
      });
    });
    this.formulario.controls.ofertaId.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((id) => this.elegirOferta(id));
    // Cambiar cualquier dato es otro pedido: la clave anterior ya no lo identifica.
    this.formulario.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => (this.clave = nuevaClaveDeIntento()));
  }

  protected cargarOfertas(): void {
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      this.errorDeOfertas.set(errorSinContextoDeActividad());
      return;
    }
    this.errorDeOfertas.set(null);
    this.ofertas.set(null);
    this.api.ofertasGrupales(consultorioId).subscribe({
      next: (ofertas) => this.ofertas.set(ofertas),
      error: (error: unknown) => {
        this.ofertas.set([]);
        this.errorDeOfertas.set(traducirErrorActividad(error));
      },
    });
  }

  protected invalido(campo: keyof typeof this.formulario.controls): boolean {
    const control = this.formulario.controls[campo];
    return control.invalid && (control.touched || this.intentado());
  }

  protected errorDelServidor(campo: string): string {
    return this.error()?.campos[campo] ?? '';
  }

  /** La ayuda del cupo siempre; el error, cuando lo hay (del formulario o del servidor). */
  protected descripcionDeCapacidad(): string {
    const conError = this.invalido('capacidad') || this.errorDelServidor('capacidad') !== '';
    return (
      'clase-capacidad-ayuda' +
      (conError ? ' clase-capacidad-error' : '') +
      (this.conflicto() === 'cupo' ? ' clase-conflicto-cupo' : '')
    );
  }

  protected programar(): void {
    this.intentado.set(true);
    this.finAntesDeInicio.set(false);
    const consultorioId = this.tenant.consultorioId();
    if (consultorioId === null) {
      this.error.set(errorSinContextoDeActividad());
      return;
    }
    if (this.formulario.invalid || this.enviando()) {
      this.formulario.markAllAsTouched();
      // El foco al primer campo en error: el boton no dice que fallo (WCAG 3.3.1).
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
        { injector: this.injector },
      );
      return;
    }
    const valor = this.formulario.getRawValue();
    const zona = this.diaDeLaSede.zona();
    const inicio = instanteDesdeHoraDeSede(valor.fecha, valor.horaInicio, zona);
    const fin = instanteDesdeHoraDeSede(valor.fecha, valor.horaFin, zona);
    if (inicio === null || fin === null || fin <= inicio) {
      this.error.set(null);
      this.finAntesDeInicio.set(true);
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>('#clase-fin')?.focus(),
        {
          injector: this.injector,
        },
      );
      return;
    }
    const profesionalId = Number(valor.profesionalId);
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .programar(consultorioId, Number(valor.ofertaId), {
        inicio,
        fin,
        capacidad: Number(valor.capacidad),
        profesionalId: valor.profesionalId !== '' && profesionalId > 0 ? profesionalId : undefined,
        espacioId: valor.espacioId === '' ? undefined : Number(valor.espacioId),
        titulo: valor.titulo.trim() === '' ? undefined : valor.titulo.trim(),
        idempotencyKey: this.clave,
      })
      .subscribe({
        next: (clase) => {
          this.enviando.set(false);
          // Pantalla propia de alta: navega y publica el aviso, que vive en el shell (UX-12).
          this.avisos.exito('Clase programada', {
            descripcion: [
              this.ofertaElegida()?.nombreComercial,
              `${valor.fecha} de ${valor.horaInicio} a ${valor.horaFin}`,
            ]
              .filter(Boolean)
              .join(' · '),
          });
          this.router
            .navigateByUrl(clase.id !== undefined ? rutaDeClase(clase.id) : RUTA_CLASES)
            .catch((error: unknown) => console.error('No se pudo abrir la clase', error));
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorActividad(error);
          if (traducido.accion === 'reintentar-con-clave-nueva') {
            this.clave = nuevaClaveDeIntento();
          }
          this.error.set(traducido);
        },
      });
  }

  private elegirOferta(id: string): void {
    const oferta = (this.ofertas() ?? []).find((o) => String(o.id) === id) ?? null;
    this.ofertaElegida.set(oferta);
    this.profesionales.set([]);
    this.espacios.set([]);
    this.formulario.controls.profesionalId.setValue('');
    this.formulario.controls.espacioId.setValue('');
    const consultorioId = this.tenant.consultorioId();
    if (oferta === null || oferta.id === undefined || consultorioId === null) {
      return;
    }
    if (oferta.capacidad) {
      this.formulario.controls.capacidad.setValue(oferta.capacidad);
    }
    if (oferta.duracionMinutos) {
      this.formulario.controls.horaFin.setValue(
        sumarMinutos(this.formulario.controls.horaInicio.value, oferta.duracionMinutos),
      );
    }
    const ofertaId = oferta.id;
    this.api
      .habilitaciones(consultorioId, ofertaId)
      .pipe(catchError(() => of(null)))
      .subscribe((respuesta) => {
        if (this.ofertaElegida()?.id !== ofertaId) {
          return;
        }
        this.cargarEspacios(ofertaId, consultorioId, respuesta);
        if (!oferta.requiereProfesional) {
          return;
        }
        if (respuesta?.restringidaPorProfesional) {
          this.profesionales.set(
            (respuesta.profesionales ?? [])
              .filter((p) => p.estado === 'ACTIVO' && p.membershipId !== undefined)
              .map((p) => ({
                membershipId: p.membershipId as number,
                nombre: p.nombre || `Profesional #${p.membershipId}`,
              })),
          );
          return;
        }
        this.cargarProfesionalesDeLaOrganizacion(ofertaId);
      });
  }

  private cargarEspacios(
    ofertaId: number,
    consultorioId: number,
    habilitaciones: HabilitacionesResponse | null,
  ): void {
    this.api
      .espaciosElegibles(this.tenant.organizationId(), consultorioId, habilitaciones)
      .subscribe((espacios) => {
        if (this.ofertaElegida()?.id === ofertaId) {
          this.espacios.set(espacios);
        }
      });
  }

  /** Oferta sin restriccion: cualquiera con vinculo vigente puede prestarla. */
  private cargarProfesionalesDeLaOrganizacion(ofertaId: number): void {
    const organizationId = this.tenant.organizationId();
    if (organizationId === null) {
      return;
    }
    const consultorioId = this.tenant.consultorioId();
    this.api
      .profesionalesDeLaOrganizacion(organizationId)
      .pipe(catchError(() => of([])))
      .subscribe((miembros) => {
        if (this.ofertaElegida()?.id !== ofertaId) {
          return;
        }
        this.profesionales.set(
          miembros
            .filter(
              (m) =>
                m.id !== undefined &&
                (m.consultorioId === undefined ||
                  m.consultorioId === null ||
                  m.consultorioId === consultorioId),
            )
            .map((m) => ({
              membershipId: m.id as number,
              nombre: m.accountName || m.accountEmail || `Profesional #${m.id}`,
            })),
        );
      });
  }
}

/** `HH:mm` + minutos, sin pasar de las 23:59. */
export function sumarMinutos(hora: string, minutos: number): string {
  const [h, m] = hora.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return hora;
  }
  const total = Math.min(h * 60 + m + minutos, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
