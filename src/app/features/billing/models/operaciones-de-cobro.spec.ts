import { Cobro, CobroEstadoEnum } from '../../../api/generated/model/cobro';
import { Obligacion, ObligacionEstadoEnum } from '../../../api/generated/model/obligacion';
import {
  deudasImputables,
  motivoParaNoAnular,
  motivoParaNoReintegrar,
  reintegradoEnCentavos,
} from './operaciones-de-cobro';

/**
 * Spec de las reglas de UX de anulacion, reintegro e imputacion posterior (F-3).
 *
 * <p>Lo que importa: que lo reintegrado se despeje <b>exacto</b> de la invariante del contrato
 * —0.1 + 0.2 en flotante no da 0.3— y que la imputacion solo ofrezca deudas de la misma sede.
 */
describe('operaciones-de-cobro', () => {
  const cobro: Cobro = {
    id: 1,
    consultorioId: 3,
    moneda: 'ARS',
    total: 0.3,
    imputaciones: [{ obligacionId: 9, importe: 0.1 }],
    saldoAFavor: 0.2,
    estado: CobroEstadoEnum.VIGENTE,
  };

  it('despeja lo reintegrado en centavos exactos', () => {
    expect(reintegradoEnCentavos(cobro)).toBe(0);
    expect(reintegradoEnCentavos({ ...cobro, saldoAFavor: 0.15 })).toBe(5);
  });

  it('explica por que no se anula o no se reintegra', () => {
    expect(motivoParaNoAnular(cobro)).toBeNull();
    expect(motivoParaNoAnular({ ...cobro, saldoAFavor: 0.15 })).toContain('devolvio');
    expect(motivoParaNoAnular({ ...cobro, estado: CobroEstadoEnum.ANULADO })).toContain('anulado');
    expect(motivoParaNoReintegrar(cobro)).toBeNull();
    expect(motivoParaNoReintegrar({ ...cobro, saldoAFavor: 0 })).toContain('saldo a favor');
  });

  it('solo ofrece deudas de la misma sede y moneda, vivas y con saldo', () => {
    const base: Obligacion = {
      consultorioId: 3,
      moneda: 'ARS',
      estado: ObligacionEstadoEnum.PENDIENTE,
      saldo: 10,
    };
    const deudas: Obligacion[] = [
      { ...base, id: 1 },
      { ...base, id: 2, consultorioId: 4 },
      { ...base, id: 3, moneda: 'USD' },
      { ...base, id: 4, estado: ObligacionEstadoEnum.PAGADA, saldo: 0 },
      { ...base, id: 5, estado: ObligacionEstadoEnum.ANULADA },
    ];
    expect(deudasImputables(cobro, deudas).map((d) => d.id)).toEqual([1]);
  });
});
