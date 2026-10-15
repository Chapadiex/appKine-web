import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';

import {
  CasoAdministrativoResponse,
  CasoAdministrativoResponseEstadoEnum,
} from '../../../api/generated/model/caso-administrativo-response';
import { CerrarSesion } from '../../../api/generated/model/cerrar-sesion';
import { ComparacionDeMediciones } from '../../../api/generated/model/comparacion-de-mediciones';
import { DefinicionesDeMedicionService } from '../../../api/generated/api/definiciones-de-medicion.service';
import { EnmendarSesion } from '../../../api/generated/model/enmendar-sesion';
import { EspacioResponse } from '../../../api/generated/model/espacio-response';
import { EspaciosService } from '../../../api/generated/api/espacios.service';
import { GuardarEvaluacion } from '../../../api/generated/model/guardar-evaluacion';
import { HistoriaClinicaService } from '../../../api/generated/api/historia-clinica.service';
import { Medicion } from '../../../api/generated/model/medicion';
import { MedicionDefinicionResponse } from '../../../api/generated/model/medicion-definicion-response';
import { MedicionesDeSesion } from '../../../api/generated/model/mediciones-de-sesion';
import { MedicionesDeSesionService } from '../../../api/generated/api/mediciones-de-sesion.service';
import { PracticaDeOferta } from '../../../api/generated/model/practica-de-oferta';
import { RegistrarMedicion } from '../../../api/generated/model/registrar-medicion';
import { RegistrarTratamiento } from '../../../api/generated/model/registrar-tratamiento';
import { ServiciosYOfertasService } from '../../../api/generated/api/servicios-y-ofertas.service';
import { Sesion } from '../../../api/generated/model/sesion';
import { SesionVersion } from '../../../api/generated/model/sesion-version';
import { SesionesService } from '../../../api/generated/api/sesiones.service';
import { Tratamiento } from '../../../api/generated/model/tratamiento';
import { TratamientosRealizadosService } from '../../../api/generated/api/tratamientos-realizados.service';
import { TurnosService } from '../../../api/generated/api/turnos.service';

/** Lado de una medicion. `BILATERAL` no existe: una medicion bilateral son dos mediciones. */
export type LadoDeMedicion = 'IZQUIERDA' | 'DERECHA' | 'NO_APLICA';

/** Lo que la pantalla necesita para ofrecer asociar la atencion a un caso (04.03). */
export interface CasosDelTurno {
  /** Oferta del turno: sugiere el caso que la comparte. Ausente si no se pudo leer el turno. */
  readonly ofertaId?: number;
  /** Casos ACTIVOS de la historia del paciente. Vacio si no tiene historia o ningun caso vivo. */
  readonly casos: readonly CasoAdministrativoResponse[];
}

/**
 * Unico punto de la feature `clinical` que toca el cliente generado (M14, AKINE-06.01 a 06.06).
 *
 * <p>Mismo criterio que `SchedulingApi` y `PersonApi`: la pantalla depende de esta clase y de los
 * tipos del contrato, nunca del servicio generado directo.
 *
 * <h2>Lo que esta fachada NO tiene</h2>
 *
 * <p><b>No hay nada economico.</b> Cerrar una atencion no cobra (DP-06): la deuda se devenga del
 * lado del backend. Un metodo de cobro colgado de esta fachada sugeriria que el cierre depende del
 * pago, que es exactamente la confusion que la regla maestra 5 existe para evitar.
 *
 * <p><b>Enmendar no es editar</b> (AKINE-06.06, C-6): una sesion cerrada no admite borrador,
 * evaluacion, mediciones ni tratamientos; se corrige con {@link enmendar}, que exige motivo y deja
 * una version nueva sin tocar la anterior. Las versiones se leen con {@link versiones}.
 */
@Injectable({ providedIn: 'root' })
export class ClinicalApi {
  private readonly sesiones = inject(SesionesService);
  private readonly mediciones = inject(MedicionesDeSesionService);
  private readonly definiciones = inject(DefinicionesDeMedicionService);
  private readonly tratamientos = inject(TratamientosRealizadosService);
  private readonly ofertas = inject(ServiciosYOfertasService);
  private readonly espacios = inject(EspaciosService);
  private readonly turnos = inject(TurnosService);
  private readonly historias = inject(HistoriaClinicaService);

  /**
   * Abre la atencion del turno, o devuelve la que ya estaba abierta.
   *
   * <p><b>Es idempotente a proposito</b> (RN-M14-001: un turno produce como mucho una sesion).
   * Abrir dos veces —doble click, recarga de la pantalla, volver desde otra pestaña— es el caso
   * normal y no hay nada que preguntarle al usuario. Por eso la pantalla monta sobre el turno y
   * no sobre la sesion: recargar la URL vuelve a la misma atencion.
   *
   * <p>`casoId` es opcional (04.03) y <b>solo cuenta al crear</b>: si la sesion ya existia se
   * devuelve con el caso que tenga, aunque esta llamada traiga otro.
   */
  iniciar(consultorioId: number, turnoId: number, casoId?: number): Observable<Sesion> {
    return this.sesiones.iniciarSesion({ consultorioId, turnoId, casoId });
  }

  /**
   * Casos ACTIVOS del paciente del turno, para ofrecer asociar la atencion a uno (04.03).
   *
   * <p>Se leen por los <b>datos administrativos</b> de la historia y no por la lectura clinica: no
   * traen diagnostico, objetivo ni motivo de cierre, no piden justificacion de acceso y no se
   * auditan como acceso clinico. Para elegir un caso alcanza con su numero, su oferta y su fecha,
   * y pedir mas seria leer contenido clinico que la pantalla no muestra.
   *
   * <p><b>Nunca falla.</b> Si el turno o la historia no se pueden leer, la atencion se inicia igual
   * sin caso, que es lo que RF-M14-002 admite: el selector es una ayuda y no una condicion.
   */
  casosDelTurno(consultorioId: number, turnoId: number): Observable<CasosDelTurno> {
    return this.turnos.verTurno({ consultorioId, turnoId }).pipe(
      switchMap((turno) => {
        if (turno.personaId === undefined) {
          return of<CasosDelTurno>({ ofertaId: turno.ofertaId, casos: [] });
        }
        return this.historias
          .verDatosAdministrativosDeHistoriaClinica({ personaId: turno.personaId })
          .pipe(
            map((datos) => ({
              ofertaId: turno.ofertaId,
              casos: (datos.casos ?? []).filter(
                (caso) => caso.estado === CasoAdministrativoResponseEstadoEnum.ACTIVO,
              ),
            })),
          );
      }),
      catchError(() => of<CasosDelTurno>({ casos: [] })),
    );
  }

  /**
   * Relee la sesion.
   *
   * <p>Es la accion que resuelve el conflicto de version: trae la `version` fresca y lo que
   * guardo la otra pestaña, sin tocar nada de lo que hay escrito en pantalla.
   */
  ver(consultorioId: number, sesionId: number): Observable<Sesion> {
    return this.sesiones.verSesion({ consultorioId, sesionId });
  }

  /**
   * Autosave del contenido libre.
   *
   * <p>`version` es la que se leyo. Sin ella dos pestañas del mismo profesional se pisan en
   * silencio, que es exactamente la perdida de datos que esta etapa existe para evitar.
   */
  guardarBorrador(
    consultorioId: number,
    sesionId: number,
    contenido: string,
    version: number,
  ): Observable<Sesion> {
    return this.sesiones.guardarBorrador({
      consultorioId,
      sesionId,
      guardarBorrador: { contenido, version },
    });
  }

  /** Evaluacion tipada. Mismo control de version que el borrador. */
  evaluar(
    consultorioId: number,
    sesionId: number,
    evaluacion: GuardarEvaluacion,
  ): Observable<Sesion> {
    return this.sesiones.evaluar({ consultorioId, sesionId, guardarEvaluacion: evaluacion });
  }

  /**
   * Cierra la atencion y le asigna su correlativo por historia clinica (AKINE-06.05).
   *
   * <p><b>Es idempotente</b>, igual que {@link iniciar}: cerrar dos veces devuelve el mismo
   * resultado con el mismo `numeroSesion` y no renumera.
   *
   * <p>La respuesta es la sesion completa —con `numeroSesion`, `cerradaEn` y el `cierre`—, asi que
   * la pantalla no necesita releer para pasar a modo lectura.
   */
  cerrar(consultorioId: number, sesionId: number, cierre: CerrarSesion): Observable<Sesion> {
    return this.sesiones.cerrarSesion({ consultorioId, sesionId, cerrarSesion: cierre });
  }

  // -------------------------------------------------------------------------------------
  // Enmienda y versiones (AKINE-06.06, C-6)
  // -------------------------------------------------------------------------------------

  /**
   * Corrige una sesion cerrada con una version nueva. <b>Reemplazo completo</b>: un campo ausente
   * queda vacio. `tratamientos` y `mediciones` ausentes, en cambio, no se tocan.
   */
  enmendar(consultorioId: number, sesionId: number, enmienda: EnmendarSesion): Observable<Sesion> {
    return this.sesiones.enmendar({ consultorioId, sesionId, enmendarSesion: enmienda });
  }

  /** Todas las versiones del contenido, de la 1 a la ultima. Vacia si la sesion sigue abierta. */
  versiones(consultorioId: number, sesionId: number): Observable<SesionVersion[]> {
    return this.sesiones.versiones({ consultorioId, sesionId });
  }

  // -------------------------------------------------------------------------------------
  // Examen fisico: mediciones (AKINE-06.03)
  // -------------------------------------------------------------------------------------

  /**
   * Catalogo de medidas ACTIVAS que el tenant ve. `ACTIVO` es el default del contrato y se pide
   * explicito igual: el formulario de examen no puede ofrecer un test dado de baja.
   */
  definicionesActivas(): Observable<MedicionDefinicionResponse[]> {
    return this.definiciones
      .searchMedicionDefiniciones({ estado: 'ACTIVO', size: 100 })
      .pipe(map((pagina) => pagina.content ?? []));
  }

  /** Mediciones de la sesion con el informe de completitud. Se lee tambien cerrada. */
  medicionesDe(consultorioId: number, sesionId: number): Observable<MedicionesDeSesion> {
    return this.mediciones.listarMedicionesDeSesion({ consultorioId, sesionId });
  }

  /** Esta sesion contra la cerrada anterior, calculada al leer. */
  compararMediciones(consultorioId: number, sesionId: number): Observable<ComparacionDeMediciones> {
    return this.mediciones.compararMedicionesDeSesion({ consultorioId, sesionId });
  }

  /** PUT idempotente: repetirlo actualiza la misma medida del mismo lado. No lleva version. */
  registrarMedicion(
    consultorioId: number,
    sesionId: number,
    definicionId: number,
    lateralidad: LadoDeMedicion,
    valor: RegistrarMedicion,
  ): Observable<Medicion> {
    return this.mediciones.registrarMedicion({
      consultorioId,
      sesionId,
      definicionId,
      lateralidad,
      registrarMedicion: valor,
    });
  }

  /** Borra una medida cargada por error. Solo con la sesion abierta; el lado es parte de la clave. */
  borrarMedicion(
    consultorioId: number,
    sesionId: number,
    definicionId: number,
    lateralidad: LadoDeMedicion,
  ): Observable<unknown> {
    return this.mediciones.borrarMedicion({ consultorioId, sesionId, definicionId, lateralidad });
  }

  // -------------------------------------------------------------------------------------
  // Tratamientos realizados (AKINE-06.04)
  // -------------------------------------------------------------------------------------

  /** Intervenciones vigentes, en orden cronologico. La lectura queda auditada en el backend. */
  tratamientosDe(consultorioId: number, sesionId: number): Observable<Tratamiento[]> {
    return this.tratamientos.listarTratamiento({ consultorioId, sesionId });
  }

  /**
   * Asienta una intervencion. Hace avanzar la `version` de la SESION: la respuesta la trae en
   * `sesionVersion` y la pantalla la tiene que adoptar, o su proximo guardado come un 409.
   */
  registrarTratamiento(
    consultorioId: number,
    sesionId: number,
    tratamiento: RegistrarTratamiento,
  ): Observable<Tratamiento> {
    return this.tratamientos.registrarTratamiento({
      consultorioId,
      sesionId,
      registrarTratamiento: tratamiento,
    });
  }

  /**
   * Baja logica con motivo. Responde 204 <b>sin la version nueva</b> de la sesion, asi que quien
   * llama tiene que releerla (pedido al backend: devolver `sesionVersion` como el alta).
   */
  darDeBajaTratamiento(
    consultorioId: number,
    sesionId: number,
    tratamientoId: number,
    motivo: string,
    version: number,
  ): Observable<unknown> {
    return this.tratamientos.darDeBaja({
      consultorioId,
      sesionId,
      tratamientoId,
      darDeBajaTratamiento: { motivo, version },
    });
  }

  /**
   * Practicas que la oferta declara (DP-11), activas y vigentes en el catalogo. Es la lista de lo
   * que se puede asentar: una practica fuera de la oferta es 409 `practica-no-habilitada-en-oferta`.
   */
  practicasDeLaOferta(consultorioId: number, ofertaId: number): Observable<PracticaDeOferta[]> {
    return this.ofertas
      .getPracticasDeOferta({ consultorioId, ofertaId })
      .pipe(
        map((respuesta) =>
          (respuesta.practicas ?? []).filter(
            (practica) => practica.estado === 'ACTIVO' && practica.vigenteEnCatalogo !== false,
          ),
        ),
      );
  }

  /** Espacios activos de la sede, para declarar el realmente utilizado (RF-M04-005). */
  espaciosDeLaSede(organizationId: number, consultorioId: number): Observable<EspacioResponse[]> {
    return this.espacios
      .listEspacios({ orgId: organizationId, consultorioId, estado: 'ACTIVO', size: 100 })
      .pipe(map((pagina) => pagina.content ?? []));
  }
}
