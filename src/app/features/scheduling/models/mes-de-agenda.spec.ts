import { semanasDelMes, sumarMeses, unirAgendas, ventanasDePedido } from './mes-de-agenda';

describe('mes-de-agenda', () => {
  it('pide el mes en tramos de catorce días, sin pasarse del fin', () => {
    expect(ventanasDePedido('2026-11-01', '2026-12-01')).toEqual([
      { desde: '2026-11-01', hasta: '2026-11-15' },
      { desde: '2026-11-15', hasta: '2026-11-29' },
      { desde: '2026-11-29', hasta: '2026-12-01' },
    ]);
  });

  it('suma meses cruzando el año', () => {
    expect(sumarMeses('2026-12-17', 1)).toBe('2027-01-01');
    expect(sumarMeses('2026-01-31', -1)).toBe('2025-12-01');
  });

  it('cuenta por día y estado, une tramos sin duplicar y marca el bloqueo sólo en su día', () => {
    const turno = (id: number, inicio: string, estado: string) => ({
      turno: { id, inicio, operativo: { estadoOperativo: estado as never } },
    });
    const agenda = unirAgendas(
      [
        {
          timezone: 'UTC',
          turnos: [
            turno(1, '2026-11-03T10:00:00Z', 'RESERVADO'),
            turno(2, '2026-11-03T11:00:00Z', 'CONFIRMADO'),
          ],
          // Dia completo del 5: termina a la medianoche del 6, que no tiene que quedar marcado.
          bloqueos: [
            { excepcionId: 9, desde: '2026-11-05T00:00:00Z', hasta: '2026-11-06T00:00:00Z' },
          ],
        },
        { timezone: 'UTC', turnos: [turno(2, '2026-11-03T11:00:00Z', 'CONFIRMADO')] },
      ],
      '2026-11-01',
      '2026-12-01',
    );

    const dias = semanasDelMes({
      primero: '2026-11-01',
      agenda,
      filtroDeTurno: () => true,
      profesionalId: null,
      estados: ['RESERVADO', 'CONFIRMADO'],
    }).flat();
    const dia = (fecha: string) => dias.find((d) => d.fecha === fecha);

    // Noviembre de 2026 empieza en domingo: la grilla arranca el lunes 26 de octubre.
    expect(dias[0]).toMatchObject({ fecha: '2026-10-26', delMes: false });
    expect(dias.length % 7).toBe(0);
    expect(dia('2026-11-03')).toMatchObject({
      total: 2,
      porEstado: [
        { estado: 'RESERVADO', cantidad: 1 },
        { estado: 'CONFIRMADO', cantidad: 1 },
      ],
    });
    expect(dia('2026-11-05')?.bloqueos).toBe(1);
    expect(dia('2026-11-06')?.bloqueos).toBe(0);
  });
});
