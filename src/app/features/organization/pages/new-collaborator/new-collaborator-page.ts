import { Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ColaboradoresService } from '../../../../api/generated/api/colaboradores.service';
import { CreateMembershipRequest } from '../../../../api/generated/model/create-membership-request';
import { ROLES_DE_VINCULO } from '../../models/roles';
import { SedesDelContexto } from '../../services/sedes-del-contexto';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CausaColaborador, traducirErrorColaborador } from '../../models/colaborador-errors';
import { crearEsperaPorLimite } from '../../../../shared/utils/espera-por-limite';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Icono } from '../../../../shared/components/icono/icono';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

/** Campos obligatorios, en el orden en que se enfoca el primero invalido tras un submit. */
const CAMPOS = ['email', 'roleCode', 'consultorioId', 'reason'] as const;

type Campo = (typeof CAMPOS)[number];

/** Estado del formulario. Los cuatro casos exigen pantalla distinta (ADR-0005). */
type EstadoAlta =
  | { readonly tipo: 'editando' }
  | { readonly tipo: 'enviando' }
  | { readonly tipo: 'ok'; readonly membershipId: number | undefined }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly causa: CausaColaborador };

/**
 * Alta de colaborador: vincula una cuenta que YA existe con la organizacion activa
 * (M05, AKINE-01.03).
 *
 * <p><b>La ruta no lleva `orgId`.</b> Es `POST /api/v1/memberships` a secas: la organizacion
 * sale del contexto de trabajo activo del token y no del cuerpo. Mandarla seria darle al
 * cliente la posibilidad de nombrar un tenant, que es exactamente lo que el contexto existe
 * para impedir.
 *
 * <p><b>No crea cuentas y no manda correos.</b> Vincula a alguien que ya se registro. Es una
 * desviacion declarada de RF-M05-001/002 -el flujo de invitacion con aceptacion queda para
 * una etapa posterior- y la pantalla lo dice, para que nadie espere que a la otra persona le
 * llegue algo.
 *
 * <p><b>El `404` de email desconocido es deliberado y la interfaz no lo vuelve comodo.</b>
 * El endpoint distingue emails con cuenta de emails sin cuenta, asi que es un oraculo de
 * existencia acotado a proposito: 10 intentos por minuto y por IP, y cada fallo auditado en
 * el tenant como `MEMBERSHIP_ALTA_RECHAZADA` con el actor y la direccion. La pantalla
 * muestra un mensaje claro -"no existe una cuenta con ese email"- y ahi se detiene: no
 * sugiere probar otras direcciones, no ofrece un buscador de emails y no autocompleta.
 * Hacer comodo el barrido convertiria un limite calculado en una funcionalidad.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Un alta a medio llenar bajo la Organizacion A no
 * puede enviarse bajo la B: el formulario se limpia con el cambio de contexto.
 */
@Component({
  selector: 'app-new-collaborator-page',
  imports: [CabeceraDePagina, Ayuda, Icono, ReactiveFormsModule, RouterLink, Alerta],
  templateUrl: './new-collaborator-page.html',
  styleUrl: '../../organization.css',
})
export class NewCollaboratorPage {
  private readonly colaboradores = inject(ColaboradoresService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosStore);

  protected readonly sedes = inject(SedesDelContexto);
  protected readonly roles = ROLES_DE_VINCULO;
  protected readonly espera = crearEsperaPorLimite();

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    roleCode: ['', [Validators.required]],
    // Mismo tratamiento del alcance que en el cambio de rol, con una diferencia: aca no
    // existe "no tocar", porque el vinculo se esta creando. Son dos opciones, no tres.
    alcance: ['organizacion' as 'organizacion' | 'sede'],
    // Obligatoria solo con alcance "sede": antes, "una sede" sin elegir cual salia como alcance
    // organizacion, en silencio. El validador se prende y apaga con el radio (ver constructor).
    consultorioId: [''],
    reason: ['', [textoRequerido]],
  });

  protected readonly estado = signal<EstadoAlta>({ tipo: 'editando' });
  protected readonly intentos = signal(0);

  protected readonly enviando = computed(() => this.estado().tipo === 'enviando');
  protected readonly hecho = computed(() => this.estado().tipo === 'ok');

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly causaError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.causa : null;
  });

  protected readonly bloqueado = computed(
    () => this.enviando() || this.hecho() || this.espera.activa(),
  );

  /** El 404 marca el email: es el campo del que habla la alerta, y la alerta lo describe. */
  protected readonly emailRechazado = computed(() => {
    const causa = this.causaError();
    return causa === 'no-encontrado' || causa === 'conflicto';
  });

  constructor() {
    this.formulario.controls.alcance.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((alcance) => {
        const sede = this.formulario.controls.consultorioId;
        sede.setValidators(alcance === 'sede' ? [Validators.required] : []);
        sede.updateValueAndValidity();
      });

    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.sedes.asegurarCargadas();
        this.formulario.reset({
          email: '',
          roleCode: '',
          alcance: 'organizacion',
          consultorioId: '',
          reason: '',
        });
        this.estado.set({ tipo: 'editando' });
        this.intentos.set(0);
      });
    });
  }

  protected mostrarError(nombre: Campo): boolean {
    const control = this.formulario.controls[nombre];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected describeEmail(): string {
    const causa = this.causaError();
    if (causa === 'no-encontrado') {
      return 'alta-email-ayuda alta-email-sin-cuenta';
    }
    if (causa === 'conflicto') {
      return 'alta-email-ayuda alta-email-vinculado';
    }
    return this.mostrarError('email') ? 'alta-email-ayuda alta-email-error' : 'alta-email-ayuda';
  }

  protected enviar(): void {
    this.intentos.update((valor) => valor + 1);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.enfocarPrimerInvalido();
      return;
    }

    if (this.bloqueado()) {
      return;
    }

    this.estado.set({ tipo: 'enviando' });

    this.colaboradores
      .createDirectMembership({ createMembershipRequest: this.armarCuerpo() })
      .subscribe({
        next: (respuesta) => this.vinculado(respuesta.membershipId),
        error: (error: unknown) => this.fallar(error),
      });
  }

  private armarCuerpo(): CreateMembershipRequest {
    const valores = this.formulario.getRawValue();
    const cuerpo: CreateMembershipRequest = {
      email: valores.email.trim(),
      roleCode: valores.roleCode,
      reason: valores.reason.trim(),
    };

    // Alcance organizacion se expresa OMITIENDO consultorioId, no mandandolo vacio: un
    // string vacio no es "sin valor" para el backend.
    if (valores.alcance === 'sede' && valores.consultorioId !== '') {
      cuerpo.consultorioId = Number(valores.consultorioId);
    }

    return cuerpo;
  }

  /**
   * UX-12: el alta es una pantalla propia, asi que al salir bien vuelve al listado (donde se ve
   * la fila nueva) y publica el aviso global, que sobrevive a la navegacion.
   */
  private vinculado(membershipId: number | undefined): void {
    this.estado.set({ tipo: 'ok', membershipId });
    this.avisos.exito('Colaborador vinculado', {
      descripcion:
        `Vínculo número ${membershipId ?? '-'}. La persona ya puede elegir esta organización ` +
        'como contexto la próxima vez que entre; AKINE no le manda ningún aviso.',
    });
    this.router.navigateByUrl('/organizacion/colaboradores').catch(() => undefined);
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorColaborador(error, {
      // El unico texto que esta pantalla sobreescribe. El `detail` del backend cubre dos casos
      // -email sin cuenta y sede de otra organizacion- porque distinguirlos seria un segundo
      // oraculo; pero la sede sale del listado de esta organizacion, asi que de este lado el
      // unico caso real es la cuenta. Se dice eso y se ofrece el camino que si la crea.
      noEncontrado:
        'Ninguna cuenta de AKINE está registrada con esa dirección. Si la persona todavía no ' +
        'se registró, invitala por correo: crea la cuenta al aceptar y queda vinculada en el ' +
        'mismo paso.',
    });

    if (traducido.causa === 'limite') {
      this.espera.iniciar(traducido.segundosDeEspera);
    }

    this.estado.set({ tipo: 'error', mensaje: traducido.mensaje, causa: traducido.causa });
  }

  private enfocarPrimerInvalido(): void {
    const nombre = CAMPOS.find((campo) => this.formulario.controls[campo].invalid);
    if (nombre === undefined) {
      return;
    }
    this.host.nativeElement.querySelector<HTMLElement>(`#alta-${nombre}`)?.focus();
  }
}
