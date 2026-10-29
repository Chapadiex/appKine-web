import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { AuditEventPageResponse } from '../../../../api/generated/model/audit-event-page-response';
import { AuditoriaService } from '../../../../api/generated/api/auditoria.service';
import { AuditEventResponse } from '../../../../api/generated/model/audit-event-response';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { ListAuditEventsRequestParams } from '../../../../api/generated/api/auditoria.serviceInterface';
import {
  FILAS_POR_PAGINA_INICIAL,
  Paginacion,
} from '../../../../shared/components/paginacion/paginacion';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { traducirErrorColaborador } from '../../models/colaborador-errors';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import {
  CamposDeSort,
  ordenDeServidor,
} from '../../../../shared/components/tabla/orden-de-servidor';
import { textoDeBusqueda } from '../../../../shared/utils/texto-de-busqueda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

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

/** Tope del contrato para la ventana temporal. Mas que esto es `400`. */
const DIAS_MAXIMOS = 90;

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

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
  imports: [
    CabeceraDePagina,
    Ayuda,
    ColumnaOrdenable,
    ReactiveFormsModule,
    RouterLink,
    Paginacion,
    Alerta,
    EstadoVacio,
    Filtros,
    Icono,
  ],
  templateUrl: './audit-page.html',
  styleUrl: '../../organization.css',
})
export class AuditPage {
  private readonly auditoria = inject(AuditoriaService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /**
   * Arranca en `inicial`, que es el quinto caso de {@link EstadoDeListado}: sin ninguno de
   * los tres filtros la consulta no es valida, asi que no hay nada que cargar al entrar.
   */
  protected readonly estado = signal<EstadoDeListado<AuditEventPageResponse>>({
    tipo: 'inicial',
  });

  /** Los cinco valores derivados del estado, con los nombres que la plantilla ya usaba. */
  private readonly vista = vistaDeListado<AuditEventResponse>(this.estado);
  protected readonly paginaActual = signal(0);

  /** Filas por pagina (UX-14): viaja como `size`; el usuario lo cambia desde el pie. */
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);

  /**
   * Orden de los resultados, pedido al servidor (DP-45). Sin el, del hecho mas nuevo al mas viejo.
   * Cambiarlo vuelve a la primera pagina con el filtro del formulario, igual que el paginado.
   */
  protected readonly orden = ordenDeServidor<CamposDeSort<ListAuditEventsRequestParams['sort']>>(
    () => {
      this.paginaActual.set(0);
      this.consultar();
    },
  );

  /** Hecho cuyo detalle esta abierto en el panel lateral, o `null`. Solo uno a la vez. */
  protected readonly detalle = signal<AuditEventResponse | null>(null);
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
    /** Refina cualquiera de los tres filtros (DP-45, `q`): tipo de evento, de entidad o un id. */
    q: [''],
  });

  protected readonly eventos = this.vista.filas;
  protected readonly totalPaginas = this.vista.totalPaginas;
  protected readonly totalEventos = this.vista.totalElementos;
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.paginaActual.set(0);
        this.orden.reiniciar();
        this.detalle.set(null);
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

  /** Abre el detalle del hecho (o lo cierra si ya era ese) y lleva el foco al panel. */
  protected alternarDetalle(evento: AuditEventResponse): void {
    if (this.detalle()?.id === evento.id) {
      this.cerrarDetalle();
      return;
    }
    this.detalle.set(evento);
    // El panel esta en el DOM pero oculto: el foco solo entra cuando ya se mostro.
    afterNextRender(() => this.enfocar('#auditoria-detalle'), { injector: this.injector });
  }

  /** Cierra el panel y devuelve el foco al boton que lo abrio. */
  protected cerrarDetalle(): void {
    const abierto = this.detalle();
    if (abierto === null) {
      return;
    }
    this.detalle.set(null);
    this.enfocar(`#auditoria-evento-${abierto.id}`);
  }

  /** Pares clave/valor de `details`, que el contrato declara como mapa libre. */
  protected detallesDe(evento: AuditEventResponse): { clave: string; valor: string }[] {
    return Object.entries(evento.details ?? {}).map(([clave, valor]) => ({ clave, valor }));
  }

  protected mostrarError(campo: 'entityType' | 'entityId' | 'actorAccountId'): boolean {
    return comoTexto(this.formulario.controls[campo].value) === '' && this.intentos() > 0;
  }

  protected buscar(): void {
    this.intentos.update((valor) => valor + 1);
    this.paginaActual.set(0);
    this.consultar();
  }

  /** Otro tamaño de pagina: vuelve a la primera con el mismo filtro. */
  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.paginaActual.set(0);
    this.consultar();
  }

  /**
   * "Limpiar filtros" del vacio: el formulario vuelve a su estado de entrada y la pantalla a
   * "elegi un filtro", que es lo que muestra sin consulta.
   */
  protected limpiarFiltros(): void {
    this.formulario.reset();
    this.paginaActual.set(0);
    this.detalle.set(null);
    this.errorVentana.set(null);
    this.intentos.set(0);
    this.estado.set(
      this.tenantContext.organizationId() === null ? { tipo: 'sin-contexto' } : { tipo: 'inicial' },
    );
  }

  protected irAPagina(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.paginaActual.set(numero);
    this.consultar();
  }

  protected consultar(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    const parametros = this.armarParametros(orgId);
    if (parametros === null) {
      return;
    }

    this.detalle.set(null);
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
    const base: ListAuditEventsRequestParams = {
      orgId,
      page: this.paginaActual(),
      size: this.porPagina(),
      q: textoDeBusqueda(valores.q),
      sort: this.orden.sort(),
    };

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
    base: ListAuditEventsRequestParams,
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
        `La ventana no puede superar los ${DIAS_MAXIMOS} días. Acorta el rango y volvé a buscar.`,
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
