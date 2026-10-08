import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { ReintentoDeNotificacion } from '../../components/reintento-de-notificacion/reintento-de-notificacion';
import { CreateInvitacionRequest } from '../../../../api/generated/model/create-invitacion-request';
import { InvitacionResponse } from '../../../../api/generated/model/invitacion-response';
import { InvitacionesService } from '../../../../api/generated/api/invitaciones.service';
import { PERMISO_COLABORADOR_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CausaInvitacion, traducirErrorInvitacion } from '../../models/invitacion-errors';
import { formatearInstante } from '../../../../shared/utils/instantes';

/** Filtro del listado. Los cuatro estados del contrato, mas "todas". */
type FiltroEstado = 'TODAS' | 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'CANCELADA';

/** En cual de los cuatro estados esta la pantalla. */
type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean }
  | { readonly tipo: 'listo'; readonly invitaciones: readonly InvitacionResponse[] };

/**
 * Roles que se pueden proponer en una invitacion.
 *
 * <p>{@code PLATFORM_ADMIN} no esta y no es un olvido: no es un rol de vinculo (ADR-0020) y el
 * backend lo rechaza con 400. Ofrecerlo seria ofrecer un error.
 */
const ROLES = [
  { codigo: 'PROFESIONAL', etiqueta: 'Profesional' },
  { codigo: 'ADMINISTRATIVO', etiqueta: 'Administrativo' },
  { codigo: 'CONSULTORIO_ADMIN', etiqueta: 'Administrador de la sede' },
  { codigo: 'ORG_ADMIN', etiqueta: 'Administrador de la organizacion' },
] as const;

/**
 * Invitaciones a colaborar (M05, AKINE-02.03).
 *
 * <h2>Que es esta pantalla y que NO es</h2>
 *
 * <p>Es la lista de <b>a quien se le escribio</b>, no la de quien trabaja en el centro. Esa otra
 * es `colaboradores`, tiene su propio permiso y su propia pantalla. Confundirlas lleva a buscar
 * acá a alguien que ya acepto, que aca figura como una fila ACEPTADA y no como un colaborador.
 *
 * <p>Por eso exige `colaborador:manage` y no `colaborador:read`, igual que el backend: lo que se
 * ve son direcciones de correo de personas que todavia no aceptaron nada.
 *
 * <h2>Las dos cosas que la pantalla no aplana</h2>
 *
 * <p><b>1. Vencida no es un estado.</b> Una invitacion cuyo enlace expiro sigue figurando
 * PENDIENTE, con `vencida: true`. Es correcto: expirar no es una decision de nadie, y la
 * invitacion sigue ocupando el lugar que impide emitir otra a la misma persona. La fila lo dice
 * con todas las letras porque el camino —reenviar— es distinto del de una pendiente comun.
 *
 * <p><b>2. Emitir no consume cupo del plan; aceptar si.</b> La nota de arriba lo explica antes de
 * que alguien invite a diez personas contando lugares que no reservo. Sin eso, el 409 al aceptar
 * llega meses despues y sin contexto.
 *
 * <p><b>El token no se muestra nunca.</b> Ni al emitir ni al reenviar: el contrato no lo
 * devuelve. Va al correo y a ningun lado mas, porque tenerlo en pantalla equivale a poder
 * aceptar la invitacion de otro.
 */
@Component({
  selector: 'app-invitaciones-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PermisoDirective,
    ConfirmacionConMotivo,
    ReintentoDeNotificacion,
  ],
  templateUrl: './invitaciones-page.html',
  styleUrl: '../../organization.css',
})
export class InvitacionesPage {
  private readonly invitaciones = inject(InvitacionesService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_COLABORADOR_MANAGE;
  protected readonly roles = ROLES;
  protected readonly formatearInstante = formatearInstante;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly filtro = signal<FiltroEstado>('PENDIENTE');

  protected readonly altaAbierta = signal(false);

  /** Invitacion con el panel de cancelacion abierto, o `null`. */
  protected readonly cancelacionAbierta = signal<number | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaInvitacion | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  protected readonly filas = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.invitaciones : [];
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  protected readonly nombreDeLaSede = computed(
    () => this.tenantContext.context()?.consultorioName ?? 'la sede activa',
  );

  /** El duplicado se muestra EN el campo del email: es lo que el usuario tiene que cambiar. */
  protected readonly errorEnElEmail = computed(() => {
    const causa = this.causaAccion();
    return causa === 'pendiente-duplicada' || causa === 'ya-vinculado';
  });

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    roleCode: ['PROFESIONAL', [Validators.required]],
    // 'SEDE' u 'ORGANIZACION'. Texto porque un `select` siempre entrega texto.
    alcance: ['SEDE'],
  });

  constructor() {
    effect(() => {
      // Las invitaciones son del tenant: cambiar de organizacion cambia todo el listado, y un
      // formulario a medio llenar apuntando al centro anterior es peor que uno vacio.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarPaneles();
        this.exito.set(null);
        this.filtro.set('PENDIENTE');
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    const filtro = this.filtro();

    this.invitaciones
      .listColaboradorInvitaciones({
        orgId,
        estado: filtro === 'TODAS' ? undefined : filtro,
      })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorInvitacion(respuesta);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
          return;
        }
        this.estado.set({ tipo: 'listo', invitaciones: respuesta });
      });
  }

  protected cambiarFiltro(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'TODAS' || valor === 'ACEPTADA' || valor === 'RECHAZADA' || valor === 'CANCELADA'
        ? valor
        : ('PENDIENTE' as const);
    this.cerrarPaneles();
    this.filtro.set(elegido);
    this.cargar();
  }

  /**
   * Una invitacion vencida sigue siendo PENDIENTE, y la fila tiene que decirlo.
   *
   * <p>Es la distincion que evita el reporte de bug del modulo: "le mande la invitacion y no
   * puede entrar". El estado administrativo no cambio; lo que caduco es el enlace, y la salida
   * es reenviar.
   */
  protected rotuloDeEstado(invitacion: InvitacionResponse): string {
    switch (invitacion.estado) {
      case 'ACEPTADA':
        return 'Aceptada';
      case 'RECHAZADA':
        return 'Rechazada';
      case 'CANCELADA':
        return 'Cancelada';
      default:
        // PENDIENTE, y el caso en que el backend mande un estado que este cliente no conoce.
        // Los dos se leen igual: la invitacion sigue esperando respuesta.
        return invitacion.vencida ? 'Pendiente, con el enlace vencido' : 'Pendiente';
    }
  }

  /** `true` si la fila admite reenviar o cancelar: solo las que siguen pendientes. */
  protected estaPendiente(invitacion: InvitacionResponse): boolean {
    return invitacion.estado === 'PENDIENTE';
  }

  /** Como se llama el rol en pantalla; el codigo crudo si no lo conocemos. */
  protected etiquetaDeRol(codigo: string | undefined): string {
    return ROLES.find((rol) => rol.codigo === codigo)?.etiqueta ?? codigo ?? '';
  }

  protected abrirAlta(): void {
    this.cerrarPaneles();
    this.exito.set(null);
    this.formularioAlta.enable();
    this.formularioAlta.reset({ email: '', roleCode: 'PROFESIONAL', alcance: 'SEDE' });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#invitacion-email'), { injector: this.injector });
  }

  protected abrirCancelacion(invitacion: InvitacionResponse): void {
    const id = invitacion.id;
    if (id === undefined) {
      return;
    }
    this.cerrarPaneles();
    this.exito.set(null);
    this.cancelacionAbierta.set(id);
  }

  protected cerrarPaneles(): void {
    this.altaAbierta.set(false);
    this.cancelacionAbierta.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.intentos.set(0);
  }

  protected mostrarError(campo: 'email' | 'roleCode'): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected enviarAlta(): void {
    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();
    if (orgId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar('#invitacion-email');
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const cuerpo: CreateInvitacionRequest = {
      email: valores.email.trim(),
      roleCode: valores.roleCode,
    };

    // Alcance SEDE con contexto de sede: el vinculo se acota a la sede activa. Sin sede en el
    // contexto la unica opcion posible es ORGANIZACION, y la plantilla no ofrece la otra.
    if (valores.alcance === 'SEDE' && consultorioId !== null) {
      cuerpo.consultorioId = consultorioId;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.invitaciones
      .createColaboradorInvitacion({ orgId, createInvitacionRequest: cuerpo })
      .subscribe({
        next: () => {
          this.cerrarPaneles();
          this.exito.set(
            'La invitacion salio por correo. Va a figurar como pendiente hasta que la persona ' +
              'responda: el vinculo se crea cuando acepta, no ahora.',
          );
          this.filtro.set('PENDIENTE');
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * Rota el token y vuelve a mandar el correo.
   *
   * <p>El mensaje de exito dice que el enlace anterior dejo de servir, porque es un efecto que
   * el usuario no pidio y que importa: si el invitado tenia el correo viejo abierto, ese enlace
   * ya no funciona.
   */
  protected reenviar(invitacion: InvitacionResponse): void {
    const orgId = this.tenantContext.organizationId();
    const id = invitacion.id;
    if (orgId === null || id === undefined || this.enviando()) {
      return;
    }

    this.cerrarPaneles();
    this.enviando.set(true);
    this.exito.set(null);

    this.invitaciones.resendColaboradorInvitacion({ orgId, invitacionId: id }).subscribe({
      next: () => {
        this.enviando.set(false);
        this.exito.set(
          'Le mandamos un enlace nuevo. El anterior dejo de servir en el mismo acto, asi que si ' +
            'todavia tenia el correo viejo abierto, tiene que usar el ultimo.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  protected enviarCancelacion(motivo: string): void {
    const orgId = this.tenantContext.organizationId();
    const id = this.cancelacionAbierta();
    if (orgId === null || id === null || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.invitaciones
      .cancelColaboradorInvitacion({
        orgId,
        invitacionId: id,
        cancelInvitacionRequest: { reason: motivo },
      })
      .subscribe({
        next: () => {
          this.cerrarPaneles();
          this.exito.set(
            'La invitacion quedo cancelada y su enlace dejo de servir. Podes volver a invitar a ' +
              'esa persona mas adelante.',
          );
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorInvitacion(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
