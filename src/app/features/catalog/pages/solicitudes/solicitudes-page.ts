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

import { CatalogoClinicoService } from '../../../../api/generated/api/catalogo-clinico.service';
import { CatalogoSolicitudResponse } from '../../../../api/generated/model/catalogo-solicitud-response';
import { CreateCatalogoSolicitudRequest } from '../../../../api/generated/model/create-catalogo-solicitud-request';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CausaCatalogo, traducirErrorCatalogo } from '../../models/catalogo-errors';
import { TIPOS_DE_CATALOGO } from '../../models/tipos-de-catalogo';
import { formatearInstante } from '../../../../shared/utils/instantes';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';

/** Filtro de estado del listado. Los tres valores son los del contrato, mas "todas". */
type FiltroEstado = 'TODAS' | 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';

/** En cual de los cuatro estados esta la pantalla. */
type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean }
  | { readonly tipo: 'listo'; readonly solicitudes: readonly CatalogoSolicitudResponse[] };

/**
 * Pedidos al catalogo de la plataforma (RF-M06-005, AKINE-02.05).
 *
 * <p>Es la salida del `403` que reciben los conceptos globales: un centro <b>no</b> puede
 * crear ni editar el catalogo comun -lo ven todos los demas centros-, pero si puede pedir que
 * algo entre. La solicitud queda registrada, la plataforma la resuelve, y el centro ve como
 * quedo en este mismo listado.
 *
 * <p><b>Esta pantalla no resuelve solicitudes.</b> El contrato publica la operacion, pero
 * resolverla exige rol de plataforma y el frontend no tiene hoy ninguna forma de saber si
 * quien mira lo tiene: no hay endpoint que lo diga. Mostrar botones de aprobar y rechazar a
 * todo el mundo seria ofrecerle a cada administrador de centro dos acciones que siempre
 * terminan en `403`. La consola de plataforma es una etapa propia; queda anotado como deuda
 * en el diseño de la etapa.
 *
 * <p><b>Un pedido no es un concepto.</b> Lo que se carga es una <b>propuesta</b> -un nombre y
 * un codigo sugeridos- y la plataforma puede aprobarla con otro nombre, o rechazarla. Por eso
 * los campos se llaman "propuesto" en pantalla y no "nombre" a secas: quien pide no esta
 * dando de alta nada.
 */
@Component({
  selector: 'app-solicitudes-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective],
  templateUrl: './solicitudes-page.html',
  styleUrl: '../../catalog.css',
})
export class SolicitudesPage {
  private readonly catalogo = inject(CatalogoClinicoService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly tipos = TIPOS_DE_CATALOGO;
  protected readonly formatearInstante = formatearInstante;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly filtroEstado = signal<FiltroEstado>('TODAS');

  protected readonly altaAbierta = signal(false);
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaCatalogo | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  protected readonly solicitudes = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.solicitudes : [];
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  /** El duplicado se muestra EN el campo del nombre: es lo que el usuario tiene que cambiar. */
  protected readonly errorEnElNombre = computed(() => this.causaAccion() === 'solicitud-duplicada');

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    // Texto y no enum: un `select` siempre entrega texto. Se valida contra los tres del contrato.
    tipo: ['', [Validators.required]],
    nombrePropuesto: ['', [textoRequerido]],
    codigoPropuesto: [''],
    justificacion: ['', [textoRequerido]],
  });

  constructor() {
    effect(() => {
      // Las solicitudes son del tenant: cambiar de organizacion cambia todo el listado, y un
      // formulario a medio llenar apuntando al centro anterior es peor que uno vacio.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarAlta();
        this.exito.set(null);
        this.filtroEstado.set('TODAS');
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    if (this.tenantContext.organizationId() === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    const filtro = this.filtroEstado();

    this.catalogo
      .listCatalogoSolicitudes({ estado: filtro === 'TODAS' ? undefined : filtro })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorCatalogo(respuesta);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
          return;
        }
        this.estado.set({ tipo: 'listo', solicitudes: respuesta });
      });
  }

  protected cambiarFiltro(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'PENDIENTE' || valor === 'APROBADA' || valor === 'RECHAZADA'
        ? valor
        : ('TODAS' as const);
    this.cerrarAlta();
    this.filtroEstado.set(elegido);
    this.cargar();
  }

  protected abrirAlta(): void {
    this.exito.set(null);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.intentos.set(0);
    this.formularioAlta.enable();
    this.formularioAlta.reset({
      tipo: '',
      nombrePropuesto: '',
      codigoPropuesto: '',
      justificacion: '',
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#solicitud-tipo'), { injector: this.injector });
  }

  protected cerrarAlta(): void {
    this.altaAbierta.set(false);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.intentos.set(0);
  }

  protected mostrarError(campo: 'tipo' | 'nombrePropuesto' | 'justificacion'): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected enviar(): void {
    if (this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(
        this.formularioAlta.controls.tipo.invalid ? '#solicitud-tipo' : '#solicitud-nombre',
      );
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const cuerpo: CreateCatalogoSolicitudRequest = {
      tipo: valores.tipo as CreateCatalogoSolicitudRequest['tipo'],
      nombrePropuesto: valores.nombrePropuesto.trim(),
      justificacion: valores.justificacion.trim(),
    };

    const codigo = valores.codigoPropuesto.trim();
    if (codigo !== '') {
      cuerpo.codigoPropuesto = codigo;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);

    this.catalogo.createCatalogoSolicitud({ createCatalogoSolicitudRequest: cuerpo }).subscribe({
      next: () => {
        this.cerrarAlta();
        this.exito.set(
          'Tu pedido quedo registrado. Lo resuelve la plataforma: vas a ver como quedo en este ' +
            'mismo listado. Mientras tanto, si lo necesitas ya, podes darlo de alta como un ' +
            'concepto de tu centro.',
        );
        this.cargar();
      },
      error: (error: unknown) => {
        const traducido = traducirErrorCatalogo(error);
        this.enviando.set(false);
        this.errorAccion.set(traducido.mensaje);
        this.causaAccion.set(traducido.causa);
      },
    });
  }

  /** Como se llama el tipo de una solicitud en pantalla. */
  protected etiquetaDeTipo(solicitud: CatalogoSolicitudResponse): string {
    switch (solicitud.tipo) {
      case 'ESPECIALIDAD':
        return 'Especialidad';
      case 'PRACTICA':
        return 'Practica';
      case 'NOMENCLADOR':
        return 'Nomenclador';
      default:
        return 'Concepto';
    }
  }

  /** Que le paso a la solicitud, en una linea. */
  protected etiquetaDeEstado(solicitud: CatalogoSolicitudResponse): string {
    switch (solicitud.estado) {
      case 'APROBADA':
        return 'Aprobada';
      case 'RECHAZADA':
        return 'Rechazada';
      default:
        return 'Pendiente';
    }
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
