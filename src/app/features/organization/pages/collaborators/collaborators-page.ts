import { Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { AssignGrantRequest } from '../../../../api/generated/model/assign-grant-request';
import { ChangeMembershipRequest } from '../../../../api/generated/model/change-membership-request';
import { ColaboradoresService } from '../../../../api/generated/api/colaboradores.service';
import { MembershipGrantResponse } from '../../../../api/generated/model/membership-grant-response';
import { MembershipPageResponse } from '../../../../api/generated/model/membership-page-response';
import { MembershipResponse } from '../../../../api/generated/model/membership-response';
import { PERMISOS_F1, PERMISO_COLABORADOR_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { ETIQUETA_DE_ESTADO, ROLES_DE_VINCULO, etiquetaDeRol } from '../../models/roles';
import { SedesDelContexto } from '../../services/sedes-del-contexto';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { traducirErrorColaborador } from '../../models/colaborador-errors';

/** Estado del listado (ADR-0005: los cuatro casos son pantallas distintas). */
type EstadoListado =
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly pagina: MembershipPageResponse }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'suspender' | 'reactivar' | 'revocar' | 'permisos';

/**
 * Cuantos colaboradores se piden por pagina.
 *
 * <p>Muy por debajo del tope de 100 que el backend recorta: la tabla se lee de un vistazo y
 * cada fila trae acciones. Pedir 100 no ahorraria un request en ningun centro real.
 */
const POR_PAGINA = 20;

/**
 * Gestion de colaboradores de la organizacion activa (M05, AKINE-01.03).
 *
 * <p>Consume `GET /organizations/{orgId}/memberships` con `colaborador:read`, y las cinco
 * mutaciones que piden `colaborador:manage`. El `orgId` sale de {@link TenantContextStore}:
 * la pantalla no guarda una copia.
 *
 * <p><b>Los revocados NO desaparecen.</b> El listado incluye vinculos suspendidos y
 * revocados, y la fila se distingue por el campo `estado` y nunca por ausencia
 * (RN-M05-003). La baja es logica porque los historicos clinicos y economicos siguen
 * apuntando a esa persona: quien administra tiene que poder ver quien estuvo, quien lo
 * desvinculo y con que motivo. Filtrar los revocados para "limpiar la tabla" tiraria
 * justamente la informacion por la que la baja es logica.
 *
 * <p><b>Motivo obligatorio en las cinco mutaciones.</b> No es una validacion de forma: es lo
 * que responde, seis meses despues, por que esa persona dejo de tener acceso a los datos del
 * centro. El backend lo exige igual; el formulario lo pide antes para no gastar un rechazo.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Cambiar de organizacion sin recargar dejaria en
 * pantalla los colaboradores de la anterior bajo la nueva. El `effect` depende de la epoca y
 * no del id, para que tambien dispare al limpiar el contexto (logout), y ademas cierra el
 * panel abierto: un formulario de revocacion a medio llenar apuntando a un `membershipId` de
 * otro tenant es peor que uno vacio.
 *
 * <p><b>Las acciones van detras de `*akinePermiso`, que es UX y no seguridad.</b> Quien
 * llegue con `colaborador:read` a secas ve la tabla completa y ningun boton; si igual arma
 * el `PATCH` con curl, el backend responde `403`. Ocultar no autoriza.
 */
@Component({
  selector: 'app-collaborators-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective],
  templateUrl: './collaborators-page.html',
  styleUrl: '../../organization.css',
})
export class CollaboratorsPage {
  private readonly colaboradores = inject(ColaboradoresService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly sedes = inject(SedesDelContexto);

  protected readonly permisoManage = PERMISO_COLABORADOR_MANAGE;
  protected readonly roles = ROLES_DE_VINCULO;
  protected readonly permisosOtorgables = PERMISOS_F1;
  protected readonly etiquetaDeRol = etiquetaDeRol;

  protected readonly estado = signal<EstadoListado>({ tipo: 'cargando' });
  protected readonly paginaActual = signal(0);

  /** Fila y operacion abiertas, o `null` si no hay ninguna. Solo una a la vez. */
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  /** Permisos adicionales de la fila abierta en el panel `permisos`. `null` mientras carga. */
  protected readonly grants = signal<readonly MembershipGrantResponse[] | null>(null);

  /** Motivo solo. Sirve a suspender, reactivar y revocar: las tres piden lo mismo. */
  protected readonly formularioMotivo = this.formBuilder.nonNullable.group({
    reason: ['', [Validators.required]],
  });

  /**
   * Cambio de rol y/o de alcance.
   *
   * <p><b>`alcance` es un radio de tres opciones y no un campo de sede.</b> Es la traduccion
   * literal de `changeScope`: el contrato lo agrega porque `consultorioId: null` es un valor
   * legitimo -significa "toda la organizacion"- y sin la bandera seria indistinguible de "no
   * toques la sede". Un formulario que mande siempre `consultorioId` mueve de sede a gente
   * que solo iba a cambiar de rol. Las tres opciones se traducen en {@link armarCambio}:
   *
   * <pre>
   * 'sin-cambio'   -&gt; sin changeScope y sin consultorioId  (el defecto: no se toca)
   * 'organizacion' -&gt; changeScope: true, sin consultorioId (alcance de toda la org)
   * 'sede'         -&gt; changeScope: true, consultorioId: N  (una sede concreta)
   * </pre>
   *
   * <p>`roleCode` vacio es el equivalente para el rol, que el contrato si expresa con la
   * ausencia del campo. El defecto de los dos es no tocar nada.
   */
  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    roleCode: [''],
    alcance: ['sin-cambio' as AlcanceElegido],
    consultorioId: [''],
    reason: ['', [Validators.required]],
  });

  /** Alta de un permiso adicional sobre el vinculo abierto. */
  protected readonly formularioGrant = this.formBuilder.nonNullable.group({
    permissionCode: ['', [Validators.required]],
    reason: ['', [Validators.required]],
    validUntil: [''],
  });

  protected readonly colaboradoresDeLaPagina = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? (estado.pagina.content ?? []) : [];
  });

  protected readonly totalPaginas = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? (estado.pagina.totalPages ?? 0) : 0;
  });

  protected readonly totalColaboradores = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? (estado.pagina.totalElements ?? 0) : 0;
  });

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' && estado.faltaContexto;
  });

  constructor() {
    effect(() => {
      // Dependencia explicita: cualquier cambio de contexto invalida todo lo que hay abierto.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarPanel();
        this.exito.set(null);
        this.paginaActual.set(0);
        this.sedes.asegurarCargadas();
        this.cargar();
      });
    });
  }

  protected estadoLegible(estado: string | undefined): string {
    return estado === undefined ? '-' : (ETIQUETA_DE_ESTADO[estado] ?? estado);
  }

  /**
   * Como se identifica a una persona en la tabla.
   *
   * <p>Preferencia: nombre, si no el email, y recien como ultimo recurso el id de cuenta. Hasta
   * el contrato 0.6.0 el backend solo devolvia `accountId` y esta columna decia literalmente
   * "Cuenta 100": una pantalla de administracion de personas donde no se puede saber quien es
   * cada una. El fallback se conserva porque los dos campos son opcionales en el contrato, y
   * una cuenta sin nombre resuelto tiene que seguir siendo administrable.
   */
  protected nombreDe(colaborador: MembershipResponse): string {
    return (
      colaborador.accountName?.trim() ||
      colaborador.accountEmail ||
      `Cuenta ${colaborador.accountId}`
    );
  }

  /** Nombre de la sede, o el texto de alcance organizacion cuando `consultorioId` es null. */
  protected alcanceLegible(consultorioId: number | undefined): string {
    if (consultorioId === undefined || consultorioId === null) {
      return 'Toda la organizacion';
    }
    const sede = this.sedes.sedes().find((candidata) => candidata.id === consultorioId);
    return sede?.name ?? `Sede ${consultorioId}`;
  }

  protected cargar(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.colaboradores
      .listMemberships({ orgId, page: this.paginaActual(), size: POR_PAGINA })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorColaborador(respuesta);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
          return;
        }
        this.estado.set({ tipo: 'listo', pagina: respuesta });
      });
  }

  protected irAPagina(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.cerrarPanel();
    this.paginaActual.set(numero);
    this.cargar();
  }

  /** `true` si el panel abierto es este, sobre esta fila. */
  protected panelAbierto(id: number | undefined, tipo: TipoAccion): boolean {
    const panel = this.panel();
    return panel !== null && panel.id === id && panel.tipo === tipo;
  }

  protected abrirPanel(colaborador: MembershipResponse, tipo: TipoAccion): void {
    const id = colaborador.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      // El rol arranca en el que ya tiene: el usuario ve de donde parte, y dejarlo asi manda
      // el mismo valor, que el backend acepta sin cambiar nada.
      this.formularioEdicion.reset({
        roleCode: colaborador.roleCode ?? '',
        alcance: 'sin-cambio',
        consultorioId: colaborador.consultorioId?.toString() ?? '',
        reason: '',
      });
    }

    if (tipo === 'permisos') {
      this.cargarGrants(id);
    }
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.grants.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.intentos.set(0);
    this.formularioMotivo.reset({ reason: '' });
    this.formularioGrant.reset({ permissionCode: '', reason: '', validUntil: '' });
  }

  protected mostrarErrorMotivo(): boolean {
    const control = this.formularioMotivo.controls.reason;
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarErrorEdicion(): boolean {
    const control = this.formularioEdicion.controls.reason;
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarErrorGrant(campo: 'permissionCode' | 'reason'): boolean {
    const control = this.formularioGrant.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /** Suspender, reactivar o revocar: las tres mandan `MembershipReasonRequest`. */
  protected enviarMotivo(): void {
    const panel = this.panel();
    const orgId = this.tenantContext.organizationId();
    if (panel === null || orgId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioMotivo.invalid) {
      this.formularioMotivo.markAllAsTouched();
      this.enfocar('#panel-motivo');
      return;
    }

    const parametros = {
      orgId,
      membershipId: panel.id,
      membershipReasonRequest: { reason: this.formularioMotivo.getRawValue().reason.trim() },
    };

    if (panel.tipo === 'suspender') {
      this.ejecutar(this.colaboradores.suspendMembership(parametros), 'Colaborador suspendido.');
      return;
    }

    if (panel.tipo === 'reactivar') {
      this.ejecutar(this.colaboradores.reactivateMembership(parametros), 'Colaborador reactivado.');
      return;
    }

    this.ejecutar(
      this.colaboradores.revokeMembership(parametros),
      'Vinculo revocado. La fila queda en el listado, con el motivo.',
    );
  }

  protected enviarEdicion(): void {
    const panel = this.panel();
    const orgId = this.tenantContext.organizationId();
    if (panel === null || orgId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      this.enfocar('#edicion-reason');
      return;
    }

    this.ejecutar(
      this.colaboradores.changeMembership({
        orgId,
        membershipId: panel.id,
        changeMembershipRequest: this.armarCambio(),
      }),
      'Cambio aplicado.',
    );
  }

  /** Traduce el radio de alcance a la pareja `changeScope` / `consultorioId` del contrato. */
  private armarCambio(): ChangeMembershipRequest {
    const valores = this.formularioEdicion.getRawValue();
    const cuerpo: ChangeMembershipRequest = { reason: valores.reason.trim() };

    if (valores.roleCode !== '') {
      cuerpo.roleCode = valores.roleCode as ChangeMembershipRequest['roleCode'];
    }

    if (valores.alcance === 'sin-cambio') {
      // Ni `changeScope` ni `consultorioId`: el defecto del contrato ya es no tocar la sede.
      return cuerpo;
    }

    cuerpo.changeScope = true;

    if (valores.alcance === 'sede') {
      cuerpo.consultorioId = Number(valores.consultorioId);
    }

    // 'organizacion' manda `changeScope: true` SIN `consultorioId`, que es el null del
    // contrato: alcance de toda la organizacion. Omitirlo -en vez de mandar un `undefined`
    // explicito, que para JSON es lo mismo- deja escrito que la ausencia es el valor.
    return cuerpo;
  }

  private cargarGrants(membershipId: number): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      return;
    }

    this.grants.set(null);
    this.colaboradores
      .listMembershipGrants({ orgId, membershipId })
      .pipe(catchError(() => of([] as MembershipGrantResponse[])))
      .subscribe((respuesta) => this.grants.set(respuesta));
  }

  protected asignarGrant(): void {
    const panel = this.panel();
    const orgId = this.tenantContext.organizationId();
    if (panel === null || orgId === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioGrant.invalid) {
      this.formularioGrant.markAllAsTouched();
      this.enfocar(
        this.formularioGrant.controls.permissionCode.invalid
          ? '#grant-permissionCode'
          : '#grant-reason',
      );
      return;
    }

    const valores = this.formularioGrant.getRawValue();
    const cuerpo: AssignGrantRequest = {
      permissionCode: valores.permissionCode,
      reason: valores.reason.trim(),
    };
    if (valores.validUntil !== '') {
      // El input `date` da 'YYYY-MM-DD' y el contrato pide date-time: el permiso rige hasta
      // el final de ese dia, que es lo que el usuario entiende al elegir una fecha.
      cuerpo.validUntil = new Date(`${valores.validUntil}T23:59:59Z`).toISOString();
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.exito.set(null);

    this.colaboradores
      .assignMembershipGrant({ orgId, membershipId: panel.id, assignGrantRequest: cuerpo })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.intentos.set(0);
          this.exito.set('Permiso adicional otorgado.');
          this.formularioGrant.reset({ permissionCode: '', reason: '', validUntil: '' });
          this.cargarGrants(panel.id);
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * Da de baja un permiso adicional. El motivo viaja como query param.
   *
   * <p>Va en la URL y no en el cuerpo porque un `DELETE` con cuerpo no esta garantizado de
   * punta a punta por proxies y clientes HTTP; es una decision del contrato, no de aca.
   *
   * <p>Es idempotente hacia el mismo resultado: si el permiso ya no estaba vigente responde
   * `204` igual, asi que dos clicks seguidos no producen un error que interpretar.
   */
  protected revocarGrant(permissionCode: string | undefined): void {
    const panel = this.panel();
    const orgId = this.tenantContext.organizationId();
    if (panel === null || orgId === null || permissionCode === undefined || this.enviando()) {
      return;
    }

    const reason = this.formularioGrant.getRawValue().reason.trim();
    if (reason === '') {
      // El mismo campo de motivo sirve al alta y a la baja: la baja tambien queda auditada y
      // el contrato la exige. Sin esto el usuario se comeria un 400 por un campo que ve.
      this.intentos.update((valor) => valor + 1);
      this.formularioGrant.controls.reason.markAsTouched();
      this.errorAccion.set('Escribi el motivo antes de dar de baja el permiso.');
      this.enfocar('#grant-reason');
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.exito.set(null);

    this.colaboradores
      .revokeMembershipGrant({ orgId, membershipId: panel.id, permissionCode, reason })
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.exito.set('Permiso adicional dado de baja.');
          this.cargarGrants(panel.id);
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /** Envia una mutacion que, al salir bien, cierra el panel y relee el listado. */
  private ejecutar(peticion: Observable<unknown>, hecho: string): void {
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.exito.set(null);

    peticion.subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(hecho);
        // Se relee en vez de parchear la fila en memoria: el backend pudo cambiar mas de lo
        // que se pidio -validFrom, revokedBy, el estado- y una copia optimista mostraria un
        // estado que no es el que quedo guardado.
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  private fallar(error: unknown): void {
    this.enviando.set(false);
    this.errorAccion.set(traducirErrorColaborador(error).mensaje);
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/** Las tres intenciones posibles sobre el alcance. Ver {@link CollaboratorsPage.formularioEdicion}. */
type AlcanceElegido = 'sin-cambio' | 'organizacion' | 'sede';
