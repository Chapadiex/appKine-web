import { avisoDeDevengo } from './etiquetas-de-devengo';
import { DevengoDeClaseEfectoEnum as Efecto } from '../../../api/generated/model/devengo-de-clase';

describe('avisoDeDevengo (U-39)', () => {
  it('la deuda nacida dice el importe si viene, y sin importe no escribe undefined', () => {
    const conImporte = avisoDeDevengo({
      efecto: Efecto.DEVENGADA,
      importe: 6000,
      moneda: 'ARS',
      obligacionId: 9001,
    });
    expect(conImporte?.texto).toContain('se genero la deuda de la clase por');
    expect(conImporte?.texto).toContain('6.000');
    expect(conImporte?.aviso).toBe(false);

    // Sin pase:read viaja solo el efecto (U-46 c).
    const soloEfecto = avisoDeDevengo({ efecto: Efecto.DEVENGADA });
    expect(soloEfecto?.texto).toBe('se genero la deuda de la clase.');
    expect(soloEfecto?.texto).not.toContain('undefined');
  });

  it('CON_COBROS y SIN_PRECIO son avisos, no fallos: la asistencia quedo igual', () => {
    const conCobros = avisoDeDevengo({ efecto: Efecto.CON_COBROS });
    expect(conCobros?.aviso).toBe(true);
    expect(conCobros?.texto).toContain('sigue vigente');
    expect(conCobros?.texto).toContain('se anula el cobro');

    const sinPrecio = avisoDeDevengo({ efecto: Efecto.SIN_PRECIO });
    expect(sinPrecio?.aviso).toBe(true);
    expect(sinPrecio?.texto).toContain('quedo registrada igual');
  });

  it('la anulacion dice que no se borra, y los demas efectos informan sin alarmar', () => {
    expect(avisoDeDevengo({ efecto: Efecto.ANULADA })?.texto).toContain('No se borra');
    expect(avisoDeDevengo({ efecto: Efecto.YA_DEVENGADA })?.texto).toContain('no se genero otra');
    expect(avisoDeDevengo({ efecto: Efecto.SIN_DEUDA })?.texto).toContain('no se anulo nada');
    for (const efecto of [Efecto.ANULADA, Efecto.YA_DEVENGADA, Efecto.SIN_DEUDA]) {
      expect(avisoDeDevengo({ efecto })?.aviso).toBe(false);
    }
  });

  it('sin cambio, no aplica o sin dato no dice nada', () => {
    expect(avisoDeDevengo({ efecto: Efecto.SIN_CAMBIO })).toBeNull();
    expect(avisoDeDevengo({ efecto: Efecto.NO_APLICA })).toBeNull();
    expect(avisoDeDevengo(undefined)).toBeNull();
  });
});
