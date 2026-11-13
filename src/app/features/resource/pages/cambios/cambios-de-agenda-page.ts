import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { AgendaService } from '../../../../api/generated/api/agenda.service';
import { ListarHistorialDeAgendaRequestParams } from '../../../../api/generated/api/agenda.serviceInterface';
import { ColaboradoresService } from '../../../../api/generated/api/colaboradores.service';
import { CambioDeAgenda } from '../../../../api/generated/model/cambio-de-agenda';
import { HistorialDeAgendaPage } from '../../../../api/generated/model/historial-de-agenda-page';
import { MembershipResponse } from '../../../../api/generated/model/membership-response';
import { PERMISO_AGENDA_EXCEPCIONES } from '../../../../core/models/permisos';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { PerfilPropioStore } from '../../../../core/services/perfil-propio.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { AccionesDeFila } from '../../../../shared/components/acciones-de-fila/acciones-de-fila';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { EstadoVacio } from '../../../../shared/components/estado-vacio/estado-vacio';
import { Filtros } from '../../../../shared/components/filtros/filtros';
import { Icono } from '../../../../shared/components/icono/icono';
import {
  FILAS_POR_PAGINA_INICIAL,
  Paginacion,
} from '../../../../shared/components/paginacion/paginacion';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import {
  CamposDeSort,
  ordenDeServidor,
} from '../../../../shared/components/tabla/orden-de-servidor';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { formatearInstante } from '../../../../shared/utils/instantes';
import {
  GRUPOS_DE_TIPO,
  RUTA_AGENDA,
  armarParametros,
  consultaDeReubicacion,
  motivoDeCierre,
  nombreDeRol,
  periodoDeCierre,
  textoDeEventoRelacionado,
  textoDeTipo,
  turnosDelCierre,
} from '../../models/cambios-de-agenda';
import { traducirErrorCambiosDeAgenda } from '../../models/cambios-de-agenda-errors';
import { leerParametrosDeHorarios } from '../../models/parametros-de-horarios';
import {
  ETIQUETA_PESTANAS_DE_HORARIOS,
  pestanasDeHorarios,
} from '../../models/pestanas-de-horarios';
import {
  TEXTO_LISTA_INCOMPLETA,
  TOPE_DE_VINCULOS,
  atiendeEn,
  esListaCompleta,
  nombreDeVinculo,
} from '../../models/profesionales-de-la-sede';
import { RUTAS_HORARIOS } from '../../models/rutas-de-horarios';

/**
 * Cambios de la agenda de un profesional: horario habitual, cierres y aperturas y turnos, con
 * quien hizo cada cambio, cuando y por que (contrato 0.157.0, `listarHistorialDeAgenda`).
 *
 * <p><b>Desde 0.157.0</b> los cierres generales de la sede aparecen en la agenda de cada profesional
 * que tocaron, con los turnos que le dejaron, y un traslado de sede es una sola fila.
 *
 * <p><b>Por que no es la auditoria de la organizacion.</b> Aquella exige `auditoria:read` (solo
 * administradores) y un unico filtro excluyente; esta responde la pregunta de la recepcion y del
 * profesional —"¿quien me movio este turno?"— con `agenda:excepciones`.
 *
 * <p><b>Con el permiso recortado a lo propio</b> no hay selector: la pantalla muestra la agenda de
 * quien mira e ignora un `?membershipId` ajeno. El backend lo rechazaria igual (403 con
 * `alcance: PROPIO`); la pantalla solo evita pedir lo que sabe que no le van a dar.
 *
 * <p><b>Sin profesional elegido no consulta</b>: `profesionalId` es obligatorio. Un enlace con
 * `?membershipId` (desde el detalle de un turno o el horario) lo elige de entrada.
 *
 * <p><b>Reacciona a `contextEpoch`</b>: los cambios de una organizacion no quedan en pantalla
 * bajo otra.
 */
@Component({
  selector: 'app-cambios-de-agenda-page',
  imports: [
    AccionesDeFila,
    Alerta,
    Ayuda,
    CabeceraDePagina,
    ColumnaOrdenable,
    EstadoVacio,
    Filtros,
    Icono,
    Paginacion,
    Pestanas,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './cambios-de-agenda-page.html',
  styleUrl: '../../resource.css',
})
export class CambiosDeAgendaPage {
  private readonly agenda = inject(AgendaService);
  private readonly colaboradores = inject(ColaboradoresService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly permisos = inject(PermissionsStore);
  private readonly perfil = inject(PerfilPropioStore);
  private readonly diaDeLaSede = inject(DiaDeLaSede);
  protected readonly flujo = inject(FlujoDeTurnosStore);
  private readonly fb = inject(FormBuilder);

  /** Profesional del enlace, si vino uno valido. Se lee una vez: no es estado de la pantalla. */
  private readonly delEnlace = leerParametrosDeHorarios(
    inject(ActivatedRoute).snapshot.queryParamMap,
  ).membershipId;

  protected readonly rutas = RUTAS_HORARIOS;
  protected readonly grupos = GRUPOS_DE_TIPO;
  protected readonly pestanas = computed(() =>
    pestanasDeHorarios(this.permisos.tiene(PERMISO_AGENDA_EXCEPCIONES)),
  );
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_HORARIOS;
  protected readonly textoListaIncompleta = TEXTO_LISTA_INCOMPLETA;
  protected readonly textoDeTipo = textoDeTipo;
  protected readonly nombreDeRol = nombreDeRol;
  protected readonly periodoDeCierre = periodoDeCierre;
  protected readonly turnosDelCierre = turnosDelCierre;
  protected readonly motivoDeCierre = motivoDeCierre;
  protected readonly textoDeEventoRelacionado = textoDeEventoRelacionado;
  protected readonly rutaAgenda = RUTA_AGENDA;

  /** `agenda:excepciones` recortado a la agenda propia: sin selector. */
  protected readonly soloPropio = computed(() =>
    this.permisos.soloPropio(PERMISO_AGENDA_EXCEPCIONES),
  );
  protected readonly nombreDeLaSede = computed(
    () => this.tenantContext.context()?.consultorioName ?? 'esta sede',
  );

  // --- Selector de profesional -------------------------------------------------------------

  protected readonly profesionales = signal<readonly MembershipResponse[]>([]);
  protected readonly errorProfesionales = signal<string | null>(null);
  protected readonly listaCompleta = signal(true);
  protected readonly membershipElegido = signal<number | null>(null);

  protected readonly nombreDelProfesional = computed(() => {
    const elegido = this.membershipElegido();
    const enLista = this.profesionales().find((p) => p.id === elegido);
    if (enLista !== undefined) {
      return nombreDeVinculo(enLista);
    }
    const perfil = this.perfil.perfil();
    const propio = [perfil?.firstName, perfil?.lastName].filter(Boolean).join(' ');
    return propio === '' ? 'tu agenda' : propio;
  });

  // --- Consulta ------------------------------------------------------------------------------

  protected readonly estado = signal<EstadoDeListado<HistorialDeAgendaPage>>({ tipo: 'inicial' });
  private readonly vista = vistaDeListado<CambioDeAgenda>(this.estado);
  protected readonly cambios = this.vista.filas;
  protected readonly totalPaginas = this.vista.totalPaginas;
  protected readonly totalCambios = this.vista.totalElementos;
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  protected readonly paginaActual = signal(0);
  protected readonly porPagina = signal<number>(FILAS_POR_PAGINA_INICIAL);

  /** Sin orden elegido el backend devuelve del mas nuevo al mas viejo. */
  protected readonly orden = ordenDeServidor<
    CamposDeSort<ListarHistorialDeAgendaRequestParams['sort']>
  >(() => {
    this.paginaActual.set(0);
    this.consultar();
  });

  protected readonly formulario = this.fb.nonNullable.group({
    grupos: this.fb.nonNullable.control<string[]>([]),
    desde: [''],
    hasta: [''],
    soloEstaSede: [false],
    q: [''],
  });

  /** Cuantos filtros avanzados se apartan del valor por defecto, para el contador del embudo. */
  protected readonly filtrosActivos = signal(0);

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.paginaActual.set(0);
        this.orden.reiniciar();
        this.membershipElegido.set(null);
        this.estado.set(
          this.tenantContext.organizationId() === null
            ? { tipo: 'sin-contexto' }
            : { tipo: 'inicial' },
        );
        this.perfil.asegurarCargado();
      });
    });

    // Quien elige: con alcance propio, uno mismo en cuanto se conoce su membership; si no, la
    // lista de profesionales de la sede, y el del enlace si vino uno.
    effect(() => {
      this.tenantContext.contextEpoch();
      const propio = this.soloPropio();
      const membership = this.perfil.membershipId();
      untracked(() => {
        if (this.tenantContext.organizationId() === null) {
          return;
        }
        if (propio) {
          if (membership !== null && this.membershipElegido() !== membership) {
            this.membershipElegido.set(membership);
            this.consultar();
          }
          return;
        }
        if (this.profesionales().length === 0 && this.errorProfesionales() === null) {
          this.cargarProfesionales();
        }
        if (this.delEnlace !== null && this.membershipElegido() === null) {
          this.membershipElegido.set(this.delEnlace);
          this.consultar();
        }
      });
    });
  }

  protected cargarProfesionales(): void {
    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();
    if (orgId === null || consultorioId === null) {
      return;
    }
    this.errorProfesionales.set(null);
    this.colaboradores
      .listMemberships({ orgId, page: 0, size: TOPE_DE_VINCULOS })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          this.profesionales.set([]);
          this.errorProfesionales.set(traducirErrorCambiosDeAgenda(respuesta).mensaje);
          return;
        }
        this.profesionales.set(
          (respuesta.content ?? []).filter((vinculo) => atiendeEn(vinculo, consultorioId)),
        );
        this.listaCompleta.set(esListaCompleta(respuesta));
      });
  }

  protected elegirProfesional(valor: string): void {
    const id = Number(valor);
    if (valor === '' || !Number.isFinite(id)) {
      this.membershipElegido.set(null);
      this.estado.set({ tipo: 'inicial' });
      return;
    }
    this.membershipElegido.set(id);
    this.paginaActual.set(0);
    this.consultar();
  }

  protected alternarGrupo(etiqueta: string, marcado: boolean): void {
    const control = this.formulario.controls.grupos;
    const sinEse = control.value.filter((g) => g !== etiqueta);
    control.setValue(marcado ? [...sinEse, etiqueta] : sinEse);
  }

  protected grupoMarcado(etiqueta: string): boolean {
    return this.formulario.controls.grupos.value.includes(etiqueta);
  }

  protected buscar(): void {
    this.paginaActual.set(0);
    this.consultar();
  }

  protected limpiarFiltros(): void {
    this.formulario.reset();
    this.buscar();
  }

  protected irAPagina(numero: number): void {
    if (numero < 0 || numero >= this.totalPaginas()) {
      return;
    }
    this.paginaActual.set(numero);
    this.consultar();
  }

  protected cambiarPorPagina(cantidad: number): void {
    this.porPagina.set(cantidad);
    this.paginaActual.set(0);
    this.consultar();
  }

  protected consultar(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }
    const profesionalId = this.membershipElegido();
    if (profesionalId === null) {
      this.estado.set({ tipo: 'inicial' });
      return;
    }
    const valores = this.formulario.getRawValue();
    this.filtrosActivos.set(
      (valores.grupos.length > 0 ? 1 : 0) +
        (valores.desde !== '' || valores.hasta !== '' ? 1 : 0) +
        (valores.soloEstaSede ? 1 : 0),
    );

    this.estado.set({ tipo: 'cargando' });
    this.agenda
      .listarHistorialDeAgenda(
        armarParametros({
          orgId,
          profesionalId,
          consultorioId: valores.soloEstaSede ? this.tenantContext.consultorioId() : null,
          grupos: valores.grupos,
          desde: valores.desde,
          hasta: valores.hasta,
          q: valores.q,
          page: this.paginaActual(),
          size: this.porPagina(),
          sort: this.orden.sort(),
          zona: this.diaDeLaSede.zona(),
        }),
      )
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorCambiosDeAgenda(respuesta);
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

  // --- Lectura de una fila -------------------------------------------------------------------

  protected cuando(instante: string | undefined): string {
    return formatearInstante(instante, this.diaDeLaSede.zona()) ?? '-';
  }

  /** "Ver turno" solo para turnos de la sede activa: el detalle se lee contra esa sede. */
  protected turnoDeEstaSede(cambio: CambioDeAgenda): boolean {
    return (
      cambio.turnoId !== undefined && cambio.consultorioId === this.tenantContext.consultorioId()
    );
  }

  /**
   * La agenda filtrada en "a reubicar" para lo que dejo un cierre de sede. Solo si el cierre es de la
   * sede activa: la agenda lee la sede del contexto, y en otra los turnos no estarian.
   */
  protected reubicacion(cambio: CambioDeAgenda): Readonly<Record<string, string>> | null {
    if (cambio.consultorioId !== this.tenantContext.consultorioId()) {
      return null;
    }
    return consultaDeReubicacion(cambio);
  }

  protected quien(cambio: CambioDeAgenda): string {
    return cambio.actorNombre || 'Sin registrar';
  }
}
