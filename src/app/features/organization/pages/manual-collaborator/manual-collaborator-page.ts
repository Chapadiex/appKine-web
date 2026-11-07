import { Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { InvitacionesService } from '../../../../api/generated/api/invitaciones.service';
import { ServiciosYOfertasService } from '../../../../api/generated/api/servicios-y-ofertas.service';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { CreateAltaManualRequest } from '../../../../api/generated/model/create-alta-manual-request';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { SedesDelContexto } from '../../services/sedes-del-contexto';
import { ROLES_DE_VINCULO, etiquetaDeRol } from '../../models/roles';
import { traducirErrorColaborador } from '../../models/colaborador-errors';

type Paso = 1 | 2 | 3;
interface ServicioElegido {
  readonly sedeId: number;
  readonly ofertaId: number;
}

/** Alta preparada por el administrador; la cuenta y los vínculos nacen al aceptar la invitación. */
@Component({
  selector: 'app-manual-collaborator-page',
  imports: [ReactiveFormsModule, RouterLink, Alerta],
  templateUrl: './manual-collaborator-page.html',
  styleUrl: './manual-collaborator-page.css',
})
export class ManualCollaboratorPage {
  private readonly fb = inject(FormBuilder);
  private readonly tenant = inject(TenantContextStore);
  private readonly invitaciones = inject(InvitacionesService);
  private readonly ofertasApi = inject(ServiciosYOfertasService);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly sedes = inject(SedesDelContexto);
  protected readonly roles = ROLES_DE_VINCULO;
  protected readonly paso = signal<Paso>(1);
  protected readonly sedesElegidas = signal<readonly number[]>([]);
  protected readonly serviciosElegidos = signal<readonly ServicioElegido[]>([]);
  protected readonly ofertasPorSede = signal<ReadonlyMap<number, readonly OfertaResponse[]>>(
    new Map(),
  );
  protected readonly cargandoOfertas = signal<ReadonlySet<number>>(new Set());
  protected readonly error = signal<string | null>(null);
  protected readonly enviando = signal(false);
  protected readonly intento = signal(false);
  protected readonly cambios = signal(0);

  protected readonly formulario = this.fb.nonNullable.group({
    nombre: ['', Validators.required],
    apellido: ['', Validators.required],
    tipoDocumento: ['DNI'],
    numeroDocumento: [''],
    telefono: [''],
    email: ['', [Validators.required, Validators.email]],
    roleCode: ['PROFESIONAL', Validators.required],
    profesion: [''],
    matricula: [''],
    jurisdiccion: [''],
    especialidadPrincipal: [''],
    especialidadesAdicionales: [''],
    fechaIncorporacion: [''],
    recibeTurnos: [true],
    instructorDeActividades: [false],
    activo: [true],
  });

  protected readonly esProfesional = computed(() => {
    this.cambios();
    return this.formulario.controls.roleCode.value === 'PROFESIONAL';
  });

  protected readonly esAdminOrganizacion = computed(() => {
    this.cambios();
    return this.formulario.controls.roleCode.value === 'ORG_ADMIN';
  });

  protected readonly nombreCompleto = computed(() => {
    this.cambios();
    const { nombre, apellido } = this.formulario.getRawValue();
    return [nombre.trim(), apellido.trim()].filter(Boolean).join(' ') || 'Nuevo colaborador';
  });

  protected readonly iniciales = computed(() => {
    this.cambios();
    const { nombre, apellido } = this.formulario.getRawValue();
    return `${nombre.trim().charAt(0)}${apellido.trim().charAt(0)}`.toUpperCase() || '?';
  });

  protected readonly serviciosDisponibles = computed(() => {
    const sedes = this.sedesElegidas();
    const ofertas = this.ofertasPorSede();
    return sedes.flatMap((sedeId) =>
      (ofertas.get(sedeId) ?? [])
        .filter((oferta) => oferta.id !== undefined && oferta.estado === 'ACTIVO')
        .map((oferta) => ({ sedeId, oferta })),
    );
  });

  constructor() {
    this.formulario.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.cambios.update((valor) => valor + 1);
    });
    effect(() => {
      this.tenant.contextEpoch();
      untracked(() => {
        this.formulario.reset();
        this.paso.set(1);
        this.sedesElegidas.set([]);
        this.serviciosElegidos.set([]);
        this.ofertasPorSede.set(new Map());
        this.error.set(null);
        this.sedes.asegurarCargadas();
      });
    });
  }

  protected sedeElegida(id: number | undefined): boolean {
    return id !== undefined && this.sedesElegidas().includes(id);
  }

  protected alternarSede(id: number | undefined): void {
    if (id === undefined) return;
    const anterior = this.sedesElegidas();
    const siguiente = anterior.includes(id)
      ? anterior.filter((valor) => valor !== id)
      : [...anterior, id];
    this.sedesElegidas.set(siguiente);
    this.serviciosElegidos.update((servicios) =>
      servicios.filter((servicio) => siguiente.includes(servicio.sedeId)),
    );
    if (siguiente.includes(id)) this.cargarOfertas(id);
  }

  protected elegirTodas(): void {
    const ids = this.sedes.sedes().flatMap((sede) => (sede.id === undefined ? [] : [sede.id]));
    this.sedesElegidas.set(ids);
    for (const id of ids) this.cargarOfertas(id);
  }

  protected servicioElegido(sedeId: number, ofertaId: number | undefined): boolean {
    return (
      ofertaId !== undefined &&
      this.serviciosElegidos().some(
        (servicio) => servicio.sedeId === sedeId && servicio.ofertaId === ofertaId,
      )
    );
  }

  protected alternarServicio(sedeId: number, ofertaId: number | undefined): void {
    if (ofertaId === undefined) return;
    this.serviciosElegidos.update((actuales) =>
      actuales.some((servicio) => servicio.sedeId === sedeId && servicio.ofertaId === ofertaId)
        ? actuales.filter(
            (servicio) => servicio.sedeId !== sedeId || servicio.ofertaId !== ofertaId,
          )
        : [...actuales, { sedeId, ofertaId }],
    );
  }

  protected avanzar(): void {
    this.error.set(null);
    if (this.paso() === 1) {
      for (const nombre of ['nombre', 'apellido', 'roleCode'] as const) {
        this.formulario.controls[nombre].markAsTouched();
      }
      if (
        this.formulario.controls.nombre.invalid ||
        this.formulario.controls.apellido.invalid ||
        this.formulario.controls.roleCode.invalid
      )
        return;
      this.paso.set(2);
      return;
    }
    if (this.paso() === 2) {
      if (!this.esAdminOrganizacion() && this.sedesElegidas().length === 0) {
        this.error.set('Elegí al menos una sede de trabajo.');
        return;
      }
      this.paso.set(3);
    }
  }

  protected volver(): void {
    this.error.set(null);
    if (this.paso() > 1) this.paso.set((this.paso() - 1) as Paso);
  }

  protected irAPaso(paso: Paso): void {
    if (paso < this.paso()) {
      this.error.set(null);
      this.paso.set(paso);
    }
  }

  protected enviar(): void {
    if (this.enviando()) return;
    this.intento.set(true);
    this.formulario.controls.email.markAsTouched();
    if (this.formulario.controls.email.invalid) {
      this.error.set('Escribí un email válido para enviar la invitación.');
      return;
    }
    if (!this.esAdminOrganizacion() && this.sedesElegidas().length === 0) {
      this.error.set('Elegí al menos una sede de trabajo.');
      this.paso.set(2);
      return;
    }
    const orgId = this.tenant.organizationId();
    if (orgId === null) {
      this.error.set('Elegí una organización para continuar.');
      return;
    }
    const valores = this.formulario.getRawValue();
    const cuerpo: CreateAltaManualRequest = {
      nombre: valores.nombre.trim(),
      apellido: valores.apellido.trim(),
      tipoDocumento: valores.tipoDocumento,
      numeroDocumento: valores.numeroDocumento.trim(),
      telefono: valores.telefono.trim(),
      email: valores.email.trim(),
      roleCode: valores.roleCode,
      profesion: valores.profesion.trim(),
      matricula: valores.matricula.trim(),
      jurisdiccion: valores.jurisdiccion.trim(),
      especialidadPrincipal: valores.especialidadPrincipal.trim(),
      especialidadesAdicionales: valores.especialidadesAdicionales
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      sedeIds: this.esAdminOrganizacion() ? [] : [...this.sedesElegidas()],
      servicios: this.esProfesional() ? [...this.serviciosElegidos()] : [],
      fechaIncorporacion: valores.fechaIncorporacion || undefined,
      recibeTurnos: this.esProfesional() && valores.recibeTurnos,
      instructorDeActividades: this.esProfesional() && valores.instructorDeActividades,
      activo: valores.activo,
    };
    const epoca = this.tenant.contextEpoch();
    this.enviando.set(true);
    this.error.set(null);
    this.invitaciones
      .createAltaManualColaborador({ orgId, createAltaManualRequest: cuerpo })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          if (this.tenant.contextEpoch() !== epoca) return;
          this.enviando.set(false);
          this.avisos.exito('Invitación enviada', {
            descripcion: `Le enviamos a ${valores.email.trim()} un enlace para completar su cuenta.`,
          });
          this.router
            .navigateByUrl('/organizacion/colaboradores/invitaciones')
            .catch(() => undefined);
        },
        error: (error: unknown) => {
          if (this.tenant.contextEpoch() !== epoca) return;
          this.enviando.set(false);
          this.error.set(traducirErrorColaborador(error).mensaje);
        },
      });
  }

  protected nombreDeSede(id: number): string {
    return this.sedes.sedes().find((sede) => sede.id === id)?.name ?? 'Sede';
  }

  protected etiquetaDeRol(): string {
    this.cambios();
    return etiquetaDeRol(this.formulario.controls.roleCode.value);
  }

  private cargarOfertas(sedeId: number): void {
    if (this.ofertasPorSede().has(sedeId) || this.cargandoOfertas().has(sedeId)) return;
    const epoca = this.tenant.contextEpoch();
    this.cargandoOfertas.update((actuales) => new Set([...actuales, sedeId]));
    this.ofertasApi
      .listOfertas({ consultorioId: sedeId, estado: 'ACTIVO' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (ofertas) => {
          if (this.tenant.contextEpoch() !== epoca) return;
          this.ofertasPorSede.update((actuales) => new Map([...actuales, [sedeId, ofertas]]));
          this.cargandoOfertas.update((actuales) => {
            const nuevo = new Set(actuales);
            nuevo.delete(sedeId);
            return nuevo;
          });
        },
        error: () => {
          if (this.tenant.contextEpoch() !== epoca) return;
          this.error.set(
            'No pudimos cargar los servicios de una sede. Reintentá seleccionándola de nuevo.',
          );
          this.cargandoOfertas.update((actuales) => {
            const nuevo = new Set(actuales);
            nuevo.delete(sedeId);
            return nuevo;
          });
        },
      });
  }
}
