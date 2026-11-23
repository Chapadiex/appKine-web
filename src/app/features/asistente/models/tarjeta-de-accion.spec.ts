import { motivoQueImpideConfirmar } from './tarjeta-de-accion';

describe('motivoQueImpideConfirmar', () => {
  it('un pago necesita monto, medio y caja abierta si es en efectivo', () => {
    const pago = {
      personaId: 5,
      total: 15000,
      medio: 'EFECTIVO',
      cajaAbierta: true,
      imputaciones: [],
    };

    expect(motivoQueImpideConfirmar('PAGO', { pago })).toBeNull();
    expect(motivoQueImpideConfirmar('PAGO', { pago: { ...pago, total: undefined } })).toBe(
      'Falta el monto.',
    );
    expect(motivoQueImpideConfirmar('PAGO', { pago: { ...pago, medio: undefined } })).toBe(
      'Elegí el medio de pago.',
    );
    expect(motivoQueImpideConfirmar('PAGO', { pago: { ...pago, cajaAbierta: false } })).toContain(
      'caja',
    );
    expect(
      motivoQueImpideConfirmar('PAGO', {
        pago: { ...pago, medio: 'TRANSFERENCIA', cajaAbierta: false },
      }),
    ).toBeNull();
  });

  it('lo aplicado a las deudas no supera ni el saldo ni el monto', () => {
    const base = { personaId: 5, total: 15000, medio: 'TRANSFERENCIA' };

    expect(
      motivoQueImpideConfirmar('PAGO', {
        pago: { ...base, imputaciones: [{ obligacionId: 1, saldo: 10000, importe: 12000 }] },
      }),
    ).toContain('saldo');
    expect(
      motivoQueImpideConfirmar('PAGO', {
        pago: {
          ...base,
          imputaciones: [
            { obligacionId: 1, saldo: 10000, importe: 10000 },
            { obligacionId: 2, saldo: 8000, importe: 8000 },
          ],
        },
      }),
    ).toContain('supera el monto');
  });

  it('la asistencia necesita una clase elegida y alguien marcado', () => {
    const clases = [
      { claseId: 1, items: [{ inscripcionId: 10, resultado: 'PRESENTE' }] },
      { claseId: 2, items: [{ inscripcionId: 20 }] },
    ];

    expect(motivoQueImpideConfirmar('ASISTENCIA_CLASE', { asistencia: { clases } })).toBe(
      'Elegí la clase.',
    );
    expect(
      motivoQueImpideConfirmar('ASISTENCIA_CLASE', { asistencia: { claseId: 2, clases } }),
    ).toContain('Marcá');
    expect(
      motivoQueImpideConfirmar('ASISTENCIA_CLASE', { asistencia: { claseId: 1, clases } }),
    ).toBeNull();
  });

  it('la atención que se cierra necesita nota, y el alta con parecidos necesita la confirmación', () => {
    expect(
      motivoQueImpideConfirmar('ATENCION', { atencion: { turnoId: 3, cerrar: true, nota: ' ' } }),
    ).toBe('Falta la nota de cierre.');
    expect(
      motivoQueImpideConfirmar('ATENCION', { atencion: { turnoId: 3, cerrar: false, nota: '' } }),
    ).toBeNull();
    expect(motivoQueImpideConfirmar('ATENCION', { atencion: { cerrar: false } })).toBe(
      'Elegí el servicio.',
    );

    expect(
      motivoQueImpideConfirmar('ATENCION', {
        atencion: { turnoId: 3, cerrar: true, nota: 'ok', tratamientos: [{ texto: 'ejercicios' }] },
      }),
    ).toContain('no reconocidos');

    const datos = { nombre: 'Laura', apellido: 'Díaz' };
    const posiblesDuplicados = [{ id: 9, etiqueta: 'Díaz, Laura' }];
    expect(
      motivoQueImpideConfirmar('PACIENTE_ALTA', { paciente: { datos, posiblesDuplicados } }),
    ).toContain('otra persona');
    expect(
      motivoQueImpideConfirmar('PACIENTE_ALTA', {
        paciente: { datos, posiblesDuplicados, confirmaPosibleDuplicado: true },
      }),
    ).toBeNull();
  });
});
