import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ConsultorioPageResponse } from '../../../../api/generated/model/consultorio-page-response';
import { ConsultorioResponse } from '../../../../api/generated/model/consultorio-response';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { ConsultoriosService } from '../../../../api/generated/api/consultorios.service';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { OrganizacionesService } from '../../../../api/generated/api/organizaciones.service';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import {
  FILAS_POR_PAGINA_INICIAL,
  Paginacion,
} from '../../../../shared/components/paginacion/paginacion';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { RUTA_SELECTOR_CONTEXTO } from '../../../../core/models/rutas';
import { SedesDelContexto } from '../../services/sedes-del-contexto';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { traducirErrorConsultorio } from '../../models/consultorio-errors';
import { MOTIVO_SEDE_INACTIVA, PARAM_MOTIVO } from '../../models/motivo-de-seleccion';
import { etiquetaDeZona } from '../../models/zonas-horarias';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { PanelLateral } from '../../../../shared/components/panel-lateral/panel-lateral';
import { Icono } from '../../../../shared/components/icono/icono';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import {
  CamposDeSort,
  ordenDeServidor,
} from '../../../../shared/components/tabla/orden-de-servidor';
import { textoDeBusqueda } from '../../../../shared/utils/texto-de-busqueda';
import { ListOrganizationConsultoriosRequestParams } from '../../../../api/generated/api/organizaciones.serviceInterface';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

/** Filtro de estado del listado. Los tres valores son los del contrato. */
type FiltroEstado = 'ACTIVO' | 'INACTIVO' | 'TODOS';

/**
 * Sedes (consultorios) de la organizacion activa (M01, AKINE-02.01).
 *
 * <p>Consume `GET /organizations/{orgId}/consultorios` —que <b>no</b> exige
 * `consultorio:manage`, porque es la misma lectura que necesita el selector de contexto— y
 * la baja, que si lo exige: `POST .../{id}/deactivate`. La edicion vive en su propia pantalla
 * (`/organizacion/sedes/:id/editar`). El `orgId` sale de {@link TenantContextStore}: la pantalla no guarda una copia.
 *
 * <p><b>Las sedes inactivas no se ocultan: se muestran como inactivas.</b> La baja es
 * logica y su historia sigue siendo relevante —turnos, sesiones y cobros historicos siguen
 * apuntando a esa sede—, asi que la fila conserva el motivo declarado y la fecha de la
 * baja. Filtrar los inactivos "para limpiar la tabla" tiraria justamente la informacion por
 * la que la baja es logica. El filtro de estado existe igual, visible y con `ACTIVO` por
 * defecto: el uso normal es el dia a dia, no la revision del historial.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Cambiar de organizacion sin recargar dejaria en
 * pantalla las sedes de la anterior bajo la nueva, y un panel de baja a medio llenar
 * apuntando a un id de otro tenant es peor que uno vacio.
 *
 * <p><b>Las acciones van detras de `*akinePermiso`, que es UX y no seguridad.</b> Quien
 * llegue sin `consultorio:manage` ve la tabla completa y ningun boton; si igual arma la
 * baja con curl, el backend responde `403`. Ocultar no autoriza.
 */
@Component({
  selector: 'app-consultorios-page',
  imports: [
    CabeceraDePagina,
    Alerta,
    Ayuda,
    Icono,
    Filtros,
    ColumnaOrdenable,
    RouterLink,
    PermisoDirective,
    Paginacion,
    EstadoVacio,
    ConfirmacionConMotivo,
    AccionesDeFila,
    PanelLateral,
  ],
  templateUrl: './consultorios-page.html',
  styleUrl: '../../organization.css',
})
export class ConsultoriosPage {
  private readonly organizaciones = inject(OrganizacionesService);
  private readonly consultorios = inject(ConsultoriosService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosStore);

  protected readonly sedesDelContexto = inject(SedesDelContexto);

  protected readonly permisoManage = PERMISO_CONSULTORIO_MANAGE;
  protected readonly etiquetaDeZona = etiquetaDeZona;

  protected readonly estado = signal<EstadoDeListado<ConsultorioPageResponse>>({
    tipo: 'cargando',
  });

  /** Los cinco valores derivados del estado, con los nombres que la plantilla ya usaba. */
  private readonly vista = vistaDeListado<ConsultorioResponse>(this.estado);
  protected readonly filtro = signal<FiltroEstado>('ACTIVO');
  /** Filtros avanzados fuera de su valor por defecto (regla de filtros, plan §3.4). */
  protected readonly filtrosAvanzadosActivos = computed(() => Number(this.filtro() !== 'ACTIVO'));
  protected readonly paginaActual = signal(0);

  /** Filas por pagina (UX-14): viaja como `size`; el usuario lo cambia desde el pie. */
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);

  /** Lo que se busca en el nombre de la sede (DP-45, `q` del servidor). */
  protected readonly busqueda = signal('');

  /** Hay busqueda o filtro fuera de su valor por defecto: decide cual de los dos vacios es. */
  protected readonly hayFiltros = computed(
    () => this.busqueda().trim() !== '' || this.filtro() !== 'ACTIVO',
  );

  /** Orden de la tabla, pedido al servidor: cambiarlo vuelve a la primera pagina (DP-45). */
  protected readonly orden = ordenDeServidor<
    CamposDeSort<ListOrganizationConsultoriosRequestParams['sort']>
  >(() => this.recargarDesdeElPrincipio());

  /** Sede con el panel de baja abierto, o `null`. Solo una a la vez. */
  protected readonly panel = signal<{ readonly id: number } | null>(null);

  /**
   * La sede del panel abierto. El panel lateral vive fuera de la tabla (refactor UX/UI del
   * 28/10/2026), asi que la busca en la pagina en vez de recibirla del `@for` de la fila.
   */
  protected readonly sedeEnPanel = computed(() => {
    const panel = this.panel();
    return panel === null
      ? null
      : (this.sedesDeLaPagina().find((sede) => sede.id === panel.id) ?? null);
  });

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);

  protected readonly sedesDeLaPagina = this.vista.filas;
  protected readonly totalPaginas = this.vista.totalPaginas;
  protected readonly totalSedes = this.vista.totalElementos;
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  constructor() {
    effect(() => {
      // Dependencia explicita: cualquier cambio de contexto invalida todo lo que hay abierto.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarPanel();
        this.paginaActual.set(0);
        this.filtro.set('ACTIVO');
        this.busqueda.set('');
        this.orden.reiniciar();
        this.sedesDelContexto.asegurarCargadas();
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

    this.organizaciones
      .listOrganizationConsultorios({
        orgId,
        estado: this.filtro(),
        page: this.paginaActual(),
        size: this.porPagina(),
        q: textoDeBusqueda(this.busqueda()),
        sort: this.orden.sort(),
      })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorConsultorio(respuesta);
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

  protected cambiarFiltro(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'INACTIVO' || valor === 'TODOS' ? valor : ('ACTIVO' as const);
    this.filtro.set(elegido);
    this.recargarDesdeElPrincipio();
  }

  protected buscar(texto: string): void {
    this.busqueda.set(texto);
    this.recargarDesdeElPrincipio();
  }

  /** "Limpiar filtros": vuelve la busqueda y el estado a su valor por defecto. */
  protected limpiarFiltros(): void {
    this.busqueda.set('');
    this.filtro.set('ACTIVO');
    this.recargarDesdeElPrincipio();
  }

  /** Otro tamaño de pagina: vuelve a la primera, que la actual puede no existir con el nuevo. */
  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.recargarDesdeElPrincipio();
  }

  /**
   * Volver a la primera pagina: la pagina 3 del filtro, la busqueda o el orden anterior puede no
   * existir en el nuevo, y el backend devolveria una pagina vacia que se lee como "no hay sedes".
   */
  private recargarDesdeElPrincipio(): void {
    this.cerrarPanel();
    this.paginaActual.set(0);
    this.cargar();
  }

  protected irAPagina(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.cerrarPanel();
    this.paginaActual.set(numero);
    this.cargar();
  }

  /** `true` si la sede es la del contexto de trabajo activo. */
  protected esLaDelContexto(id: number | undefined): boolean {
    return id !== undefined && id === this.tenantContext.consultorioId();
  }

  /** Abre el panel de baja de la sede. La edicion vive en su propia pantalla. */
  protected abrirPanel(sede: ConsultorioResponse): void {
    const id = sede.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.panel.set({ id });
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
  }

  /** La direccion de una fila del listado, o lo que la reemplaza. */
  protected direccionDe(sede: ConsultorioResponse): string | null {
    return sede.direccionFormateada ?? null;
  }

  /**
   * Da de baja la sede del panel abierto.
   *
   * <p>El motivo llega ya validado y recortado desde {@link ConfirmacionConMotivo}: que el
   * campo sea obligatorio, el foco al abrir y el `aria-describedby` del error son de la
   * primitiva, porque no dependen de que lo que se da de baja sea una sede.
   */
  protected enviarBaja(motivo: string): void {
    const panel = this.panel();
    const orgId = this.tenantContext.organizationId();
    if (panel === null || orgId === null || this.enviando()) {
      return;
    }

    this.enviando.set(true);
    this.errorAccion.set(null);

    const nombre = this.sedesDeLaPagina().find((sede) => sede.id === panel.id)?.name ?? 'La sede';
    const eraLaDelContexto = this.esLaDelContexto(panel.id);

    this.consultorios
      .deactivateConsultorio({
        orgId,
        consultorioId: panel.id,
        deactivateConsultorioRequest: { reason: motivo },
      })
      .subscribe({
        next: () => {
          this.cerrarPanel();
          this.sedesDelContexto.invalidar();

          // Una sede inactiva no recibe operaciones nuevas. Si el usuario acaba de dar de
          // baja justamente la sede sobre la que esta parado, seguir en esta pantalla lo
          // dejaria con un contexto que ya no sirve y con cada accion siguiente fallando por
          // un motivo que no se explica solo. Se lo lleva a elegir otra, diciendole por que.
          if (eraLaDelContexto) {
            this.router
              .navigate([RUTA_SELECTOR_CONTEXTO], {
                queryParams: { [PARAM_MOTIVO]: MOTIVO_SEDE_INACTIVA },
              })
              .catch((error: unknown) => {
                // Una navegacion que falla en silencio deja al usuario en esta pantalla
                // creyendo que sigue teniendo un contexto util. Se le dice, aunque no haya
                // mucho mas que hacer desde aca.
                console.error('No se pudo abrir el selector de contexto tras la baja', error);
                this.avisos.error('No pudimos abrir la pantalla para elegir otra sede', {
                  descripcion: `${nombre} quedo dada de baja. Entra a "Elegir contexto" desde el menu.`,
                  duracion: null,
                });
              });
            return;
          }

          this.avisos.exito('Sede dada de baja', {
            descripcion: `${nombre}. Sigue en el listado, con el motivo.`,
          });
          this.sedesDelContexto.asegurarCargadas();
          this.cargar();
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorConsultorio(error);
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
  }
}
