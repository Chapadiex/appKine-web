import { HttpErrorResponse } from '@angular/common/http';

import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { traducirErrorReporte } from './reporte-errors';
import {
  nombreDeArchivo,
  nombreDeReporte,
  permisoEnPalabras,
  problemaDelRango,
  valorDeIndicador,
} from './reportes';

/** Reglas del periodo (las mismas que `ReporteService` del backend) y formato de indicadores. */
describe('reportes', () => {
  describe('problemaDelRango', () => {
    it('acepta un periodo en orden de hasta 366 dias contando los dos extremos', () => {
      expect(problemaDelRango('2026-01-01', '2026-01-01')).toBeNull();
      expect(problemaDelRango('2024-01-01', '2024-12-31')).toBeNull(); // bisiesto: 366
    });

    it('rechaza extremos vacios, fechas imposibles, el periodo invertido y el demasiado ancho', () => {
      expect(problemaDelRango('', '2026-01-01')).toContain('primer y el ultimo dia');
      expect(problemaDelRango('2026-02-30', '2026-03-01')).toContain('no es valida');
      expect(problemaDelRango('2026-03-02', '2026-03-01')).toContain('termina antes de empezar');
      expect(problemaDelRango('2025-01-01', '2026-01-02')).toContain('367 dias');
    });
  });

  it('formatea el valor segun el tipo, sin sumar nada', () => {
    expect(valorDeIndicador({ tipo: 'DINERO', valor: 4500.5, moneda: 'ARS' })).toMatch(/4\.500,50/);
    expect(valorDeIndicador({ tipo: 'DINERO', valor: 10, moneda: 'XX' })).toBe('10,00 XX');
    expect(valorDeIndicador({ tipo: 'PORCENTAJE', valor: 12.34 })).toBe('12,3 %');
    expect(valorDeIndicador({ tipo: 'CONTEO', valor: 1234 })).toBe('1.234');
    expect(valorDeIndicador({ valor: 7 })).toBe('7');
    expect(valorDeIndicador({ clave: 'x' })).toBe('—');
  });

  it('nombra reportes, permisos y el archivo', () => {
    expect(nombreDeReporte('TURNOS')).toBe('Turnos');
    expect(nombreDeReporte('OTRO')).toBe('OTRO');
    expect(permisoEnPalabras('hc:read')).toBe('leer historia clinica (hc:read)');
    expect(permisoEnPalabras('x:y')).toBe('x:y');
    expect(permisoEnPalabras(undefined)).toBe('');
    expect(nombreDeArchivo('ECONOMICO', '2026-09-01', '2026-09-30')).toBe(
      'reporte-economico-2026-09-01-a-2026-09-30.csv',
    );
  });

  describe('traducirErrorReporte', () => {
    it('el rango invalido suma el maximo que publica el servidor', () => {
      const error = new AkineHttpError(
        400,
        {
          type: 'https://akine.app/problems/rango-de-reporte-invalido',
          detail: 'El periodo esta invertido',
          maximoDias: 366,
        } as never,
        false,
      );
      expect(traducirErrorReporte(error)).toEqual({
        causa: 'rango-invalido',
        mensaje: 'El periodo esta invertido. Un reporte abarca como maximo 366 dias.',
      });
    });

    it('distingue red, permiso, sede inexistente y lo desconocido', () => {
      expect(traducirErrorReporte(new AkineHttpError(0, null, true)).causa).toBe('red');
      expect(traducirErrorReporte(new AkineHttpError(403, null, false)).causa).toBe('sin-permiso');
      expect(traducirErrorReporte(new AkineHttpError(404, null, false)).causa).toBe(
        'no-encontrado',
      );
      expect(traducirErrorReporte(new AkineHttpError(500, null, false)).causa).toBe('otro');
      expect(traducirErrorReporte(new HttpErrorResponse({ status: 500 })).causa).toBe('otro');
    });
  });
});
