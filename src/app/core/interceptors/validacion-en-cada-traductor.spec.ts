import { traducirErrorInvitacion } from '../models/invitacion-errors';
import { traducirErrorActividad } from '../../features/activity/models/actividad-errors';
import { traducirErrorAsistencia } from '../../features/activity/models/asistencia-errors';
import { traducirErrorPase } from '../../features/activity/models/pase-errors';
import { traducirError } from '../../features/auth/models/auth-errors';
import { traducirErrorCaja } from '../../features/billing/models/caja-errors';
import { traducirErrorCobro } from '../../features/billing/models/cobro-errors';
import { traducirErrorEgreso } from '../../features/billing/models/egreso-errors';
import { traducirErrorObligacion } from '../../features/billing/models/obligacion-errors';
import { traducirErrorPresentacion } from '../../features/billing/models/presentacion-errors';
import { traducirErrorCatalogo } from '../../features/catalog/models/catalogo-errors';
import { traducirErrorCaso } from '../../features/clinical/casos/casos-errors';
import { traducirErrorAtencion } from '../../features/clinical/models/atencion-errors';
import { traducirErrorAtencionGrupal } from '../../features/clinical/models/atencion-grupal-errors';
import { traducirErrorDeDerivacion } from '../../features/clinical/models/derivacion-errors';
import { traducirErrorHistoria } from '../../features/clinical/models/historia-errors';
import { traducirErrorPlan } from '../../features/clinical/plan/plan-errors';
import { traducirErrorContracting } from '../../features/contracting/models/contracting-errors';
import { traducirErrorOffering } from '../../features/offering/models/offering-errors';
import {
  traducirErrorColaborador,
  traducirErrorGrant,
} from '../../features/organization/models/colaborador-errors';
import { traducirErrorConsultorio } from '../../features/organization/models/consultorio-errors';
import { traducirErrorPersona } from '../../features/person/models/person-errors';
import { traducirErrorCatalogo as traducirErrorCatalogoDePlataforma } from '../../features/platform/models/catalogo-financiadores-errors';
import { traducirErrorSolicitud } from '../../features/platform/models/solicitud-errors';
import { traducirErrorSuscripcion } from '../../features/platform/models/suscripcion-errors';
import { traducirErrorReporte } from '../../features/reporting/models/reporte-errors';
import { traducirErrorBloque } from '../../features/resource/models/bloque-errors';
import { traducirErrorEspacio } from '../../features/resource/models/espacio-errors';
import { traducirErrorExcepcion } from '../../features/resource/models/excepcion-errors';
import { traducirErrorHorarioEfectivo } from '../../features/resource/models/horario-efectivo-errors';
import {
  traducirErrorAgenda,
  traducirErrorRecepcion,
} from '../../features/scheduling/models/agenda-errors';
import { traducirErrorSerie } from '../../features/scheduling/models/series-errors';
import { AkineHttpError } from './error.interceptor';

/**
 * El mismo 400 pasado por cada traductor.
 *
 * <p>Vive en `core/` porque recorre todas las features, cosa que un spec de una feature no puede
 * hacer (ADR-0004). Lo que protege es la pantalla, no el getter: un traductor con un mensaje fijo
 * para `validation-error`, o que vuelva a leer `problem.detail`, sigue compilando y le devuelve a
 * la persona la frase que no dice que corregir.
 */
describe('un 400 con `errors` llega a la persona en cada traductor', () => {
  const TRADUCTORES: readonly [string, (error: unknown) => { readonly mensaje: string }][] = [
    ['invitacion', traducirErrorInvitacion],
    ['actividad', traducirErrorActividad],
    ['asistencia', traducirErrorAsistencia],
    ['pase', traducirErrorPase],
    ['auth', traducirError],
    ['caja', traducirErrorCaja],
    ['cobro', traducirErrorCobro],
    ['egreso', traducirErrorEgreso],
    ['obligacion', traducirErrorObligacion],
    ['presentacion', traducirErrorPresentacion],
    ['catalogo', traducirErrorCatalogo],
    ['caso', traducirErrorCaso],
    ['atencion', traducirErrorAtencion],
    ['atencion grupal', traducirErrorAtencionGrupal],
    ['derivacion', traducirErrorDeDerivacion],
    ['historia', traducirErrorHistoria],
    ['plan', traducirErrorPlan],
    ['contracting', (error) => traducirErrorContracting(error, 'financiador')],
    ['offering', (error) => traducirErrorOffering(error, 'oferta')],
    ['colaborador', traducirErrorColaborador],
    ['grant', (error) => traducirErrorGrant(error, 'PROFESIONAL')],
    ['consultorio', traducirErrorConsultorio],
    ['persona', traducirErrorPersona],
    ['catalogo de plataforma', traducirErrorCatalogoDePlataforma],
    ['solicitud', traducirErrorSolicitud],
    ['suscripcion', traducirErrorSuscripcion],
    ['reporte', traducirErrorReporte],
    ['bloque', traducirErrorBloque],
    ['espacio', traducirErrorEspacio],
    ['excepcion', traducirErrorExcepcion],
    ['horario efectivo', traducirErrorHorarioEfectivo],
    ['agenda', traducirErrorAgenda],
    ['recepcion', traducirErrorRecepcion],
    ['serie', traducirErrorSerie],
  ];

  it.each(TRADUCTORES)('%s muestra los mensajes de los campos', (_nombre, traducir) => {
    const { mensaje } = traducir(
      new AkineHttpError(
        400,
        {
          type: 'https://akine.app/problems/validation-error',
          title: 'Error de validacion',
          status: 400,
          detail: 'La solicitud contiene campos invalidos',
          errors: { apellido: 'El apellido es obligatorio', motivo: 'no debe estar vacío' },
        },
        false,
      ),
    );

    expect(mensaje).toBe('El apellido es obligatorio. Motivo: no debe estar vacío.');
  });
});
