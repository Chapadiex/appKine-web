import { advertenciasDelPlan, finEstimado } from './advertencias-del-plan';
import {
  PlanTratamiento,
  PlanTratamientoEstadoEnum,
} from '../../../api/generated/model/plan-tratamiento';
import {
  OfertaResponse,
  OfertaResponseEstadoEnum,
} from '../../../api/generated/model/oferta-response';

/**
 * Los avisos del plan salen de datos del contrato y no bloquean nada (RN-M11-004). Se prueba que
 * aparezcan cuando corresponde y, sobre todo, que un plan sano no tenga ninguno: un aviso de mas
 * entrena a ignorarlos.
 */
describe('advertenciasDelPlan', () => {
  const HOY = '2026-10-14';
  const plan = (cambios: Partial<PlanTratamiento> = {}): PlanTratamiento => ({
    id: 1,
    estado: PlanTratamientoEstadoEnum.ACTIVO,
    activadoEn: '2026-10-01T12:00:00Z',
    versionVigente: { numeroVersion: 1, duracionSemanas: 4, items: [{ ofertaId: 7 }] },
    ...cambios,
  });
  const vigente: OfertaResponse = {
    id: 7,
    nombreComercial: 'Kinesio',
    estado: OfertaResponseEstadoEnum.ACTIVO,
  };

  it('un plan sano y en fecha no tiene avisos', () => {
    const avance = { items: [{ ofertaId: 7, planificadas: 10, autorizadas: 10, realizadas: 2 }] };
    expect(advertenciasDelPlan(plan(), avance, [vigente], HOY)).toEqual([]);
  });

  it('avisa la duracion vencida, lo completo y lo planificado de mas sobre lo autorizado', () => {
    const avance = {
      completo: true,
      items: [{ ofertaId: 7, ofertaNombre: 'Kinesio', planificadas: 10, autorizadas: 8 }],
    };
    const avisos = advertenciasDelPlan(plan(), avance, [vigente], '2026-11-20');
    expect(avisos.join(' ')).toContain('termino el 29/10/2026');
    expect(avisos.join(' ')).toContain('no se finaliza solo');
    expect(avisos.join(' ')).toContain('10 sesiones planificadas y 8 autorizadas');
  });

  it('avisa la oferta que dejo de estar vigente o que vence antes del fin estimado', () => {
    const vencida = advertenciasDelPlan(plan(), null, [{ ...vigente, vigenteHoy: false }], HOY);
    expect(vencida.join(' ')).toContain('ya no esta vigente');
    const porVencer = advertenciasDelPlan(
      plan(),
      null,
      [{ ...vigente, vigenciaHasta: '2026-10-20' }],
      HOY,
    );
    expect(porVencer.join(' ')).toContain('vence el 20/10/2026');
  });

  it('un plan finalizado no avisa vencimientos: ya no esta en juego', () => {
    const avisos = advertenciasDelPlan(
      plan({ estado: PlanTratamientoEstadoEnum.FINALIZADO }),
      null,
      [{ ...vigente, vigenteHoy: false }],
      '2027-01-01',
    );
    expect(avisos).toEqual([]);
  });

  it('sin activacion o sin duracion no hay fin estimado', () => {
    expect(finEstimado(plan({ activadoEn: undefined }))).toBeNull();
    expect(finEstimado(plan({ versionVigente: {} }))).toBeNull();
  });
});
