import { Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { AuditEventPageResponse } from '../../../../api/generated/model/audit-event-page-response';
import { AuditoriaService } from '../../../../api/generated/api/auditoria.service';
import { ListAuditEventsRequestParams } from '../../../../api/generated/api/auditoria.serviceInterface';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { traducirErrorColaborador } from '../../models/colaborador-errors';

/**
 * Cual de los tres filtros excluyentes esta elegido.
 *
 * <p>El contrato exige <b>exactamente uno</b>: combinarlos o no mandar ninguno responde
 * `400`. Modelarlo como un discriminador y no como tres grupos de campos independientes es
 * lo que hace que la combinacion invalida <b>no se pueda construir</b> desde la interfaz.
 * Con tres grupos sueltos el usuario llena dos, manda, y recibe un error que no le explica
 * que la regla era de exclusion.
 */
type FiltroElegido = 'entidad' | 'actor' | 'ventana';

type EstadoAuditoria =
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'inicial' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly pagina: AuditEventPageResponse }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/** Tope del contrato para la ventana temporal. Mas que esto es `400`. */
const DIAS_MAXIMOS = 90;

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

const POR_PAGINA = 20;

/**
 * Consulta de la auditoria de la organizacion activa (M24, AKINE-01.03).
 *
 * <p>Consume `GET /organizations/{orgId}/audit-events` con `auditoria:read`. Quien tenga el
 * permiso con alcance de sede ve solo su sede: ese recorte lo decide el evaluador de
 * permisos del backend y <b>no</b> un parametro que esta pantalla pueda mandar.
 *
 * <p><b>Los tres filtros son excluyentes y el formulario lo hace imposible por
 * construccion.</b> Se elige uno con un grupo de radios y solo se renderizan -y solo se
 * validan- los campos de ese. Mandar una combinacion invalida y esperar el `400` seria
 * gastar un rechazo del servidor para descubrir una regla que ya conocemos, y dejaria al
 * usuario adivinando cual de los cinco campos que lleno estaba de mas.
 *
 * <p><b>La ventana de 90 dias se valida antes de salir.</b> Es el unico limite numerico de
 * los tres y el mas facil de superar sin darse cuenta -un rango de "todo el ano"-. El
 * backend lo rechaza igual: esto es para que el usuario vea el problema en el campo que lo
 * causa y no en un cartel al pie.
 *
 * <p><b>Arranca sin resultados, a proposito.</b> No hay consulta por defecto: sin ninguno de
 * los tres filtros la peticion es invalida, asi que un "cargar al entrar" seria un `400`
 * garantizado en cada visita. El estado inicial explica que hay que elegir un filtro.
 *
 * <p><b>Reacciona a `contextEpoch`</b>: los hechos auditados de la Organizacion A no pueden
 * quedar en pantalla bajo la B.
 */
@Component({
  selector: 'app-audit-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './audit-page.html',
  styleUrl: '../../organization.css',
})
export class AuditPage {
  private readonly auditoria = inject(AuditoriaService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly estado = signal<EstadoAuditoria>({ tipo: 'inicial' });
  protected readonly paginaActual = signal(0);
  protected readonly intentos = signal(0);

  /** Error de la ventana temporal, que ninguna validacion de campo suelto puede expresar. */
  protected readonly errorVentana = signal<string | null>(null);

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    filtro: ['entidad' as FiltroElegido],
    entityType: [''],
    entityId: [''],
    actorAccountId: [''],
    desde: [''],
    hasta: [''],
  });

  protected readonly eventos = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? (estado.pagina.content ?? []) : [];
  });

  protected readonly totalPaginas = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'listo' ? (estado.pagina.totalPages ?? 0) : 0;
  });

  protected readonly totalEventos = computed(() => {
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
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.paginaActual.set(0);
        this.errorVentana.set(null);
        this.intentos.set(0);
        this.estado.set(
          this.tenantContext.organizationId() === null
            ? { tipo: 'sin-contexto' }
            : { tipo: 'inicial' },
        );
      });
    });
  }

  /**
   * Cambiar de filtro descarta los errores del anterior.
   *
   * <p>Se llama desde el `(change)` de los radios y no desde un `valueChanges`: el valor del
   * control no es un signal, asi que envolverlo en un `computed` lo memorizaria para
   * siempre. El template lee el control directo, que Angular reevalua porque el propio
   * binding de evento del radio marca la vista sucia — que es como funciona el zoneless.
   */
  protected cambiarFiltro(): void {
    this.errorVentana.set(null);
    this.intentos.set(0);
  }

  protected mostrarError(campo: 'entityType' | 'entityId' | 'actorAccountId'): boolean {
    return comoTexto(this.formulario.controls[campo].value) === '' && this.intentos() > 0;
  }

  protected buscar(): void {
    this.intentos.update((valor) => valor + 1);
    this.paginaActual.set(0);
    this.consultar();
  }

  protected irAPagina(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.paginaActual.set(numero);
    this.consultar();
  }

  private consultar(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    const parametros = this.armarParametros(orgId);
    if (parametros === null) {
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    this.auditoria
      .listAuditEvents(parametros)
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

  /**
   * Arma exactamente uno de los tres filtros, o `null` si falta algo.
   *
   * <p>Nunca puede devolver dos filtros a la vez: cada rama construye su objeto desde cero y
   * los campos de los otros dos ni se leen. Es la propiedad que el `400` del backend
   * verifica y que aca no se puede violar aunque los campos ocultos tengan valores viejos.
   */
  private armarParametros(orgId: number): ListAuditEventsRequestParams | null {
    const valores = this.formulario.getRawValue();
    const base = { orgId, page: this.paginaActual(), size: POR_PAGINA };

    if (valores.filtro === 'entidad') {
      const entityType = comoTexto(valores.entityType);
      const entityId = comoTexto(valores.entityId);
      if (entityType === '' || entityId === '') {
        this.enfocar(entityType === '' ? '#auditoria-entityType' : '#auditoria-entityId');
        return null;
      }
      return { ...base, entityType, entityId: Number(entityId) };
    }

    if (valores.filtro === 'actor') {
      const actor = comoTexto(valores.actorAccountId);
      if (actor === '') {
        this.enfocar('#auditoria-actorAccountId');
        return null;
      }
      return { ...base, actorAccountId: Number(actor) };
    }

    return this.armarVentana(base, valores.desde, valores.hasta);
  }

  /** Valida la ventana temporal antes de salir: fechas presentes, orden y tope de 90 dias. */
  private armarVentana(
    base: { orgId: number; page: number; size: number },
    desde: string,
    hasta: string,
  ): ListAuditEventsRequestParams | null {
    if (desde === '' || hasta === '') {
      this.errorVentana.set('Indica las dos fechas de la ventana.');
      this.enfocar(desde === '' ? '#auditoria-desde' : '#auditoria-hasta');
      return null;
    }

    // El dia "hasta" se incluye entero: quien elige el 30 espera ver lo que paso ese dia.
    const inicio = new Date(`${desde}T00:00:00Z`);
    const fin = new Date(`${hasta}T23:59:59Z`);

    if (fin.getTime() <= inicio.getTime()) {
      this.errorVentana.set('La fecha final tiene que ser posterior a la inicial.');
      this.enfocar('#auditoria-hasta');
      return null;
    }

    if (fin.getTime() - inicio.getTime() > DIAS_MAXIMOS * MILISEGUNDOS_POR_DIA) {
      this.errorVentana.set(
        `La ventana no puede superar los ${DIAS_MAXIMOS} dias. Acorta el rango y volve a buscar.`,
      );
      this.enfocar('#auditoria-desde');
      return null;
    }

    this.errorVentana.set(null);
    return { ...base, from: inicio.toISOString(), to: fin.toISOString() };
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/**
 * Normaliza el valor de un control a texto recortado.
 *
 * <p>Los campos declarados como string llegan como <b>numero</b> cuando el input es
 * `type="number"`: Angular les aplica `NumberValueAccessor`, que escribe `10` y no `'10'`.
 * Un `.trim()` directo sobre eso revienta con "trim is not a function" recien al renderizar
 * el mensaje de error, que es el momento en que menos se lo espera. Vacio tambien cubre el
 * `null` que el accessor escribe cuando el usuario borra el campo.
 */
function comoTexto(valor: unknown): string {
  return valor === null || valor === undefined ? '' : String(valor).trim();
}
