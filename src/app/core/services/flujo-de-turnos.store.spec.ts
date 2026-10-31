import { FlujoDeTurnosStore } from './flujo-de-turnos.store';

/**
 * La puerta de entrada al flujo de turnos: una sola solicitud a la vez, y `cambios` para que las
 * pantallas relean sin cerrar el panel.
 */
describe('FlujoDeTurnosStore', () => {
  it('muestra una sola cosa a la vez: el último pedido reemplaza al anterior', () => {
    const flujo = new FlujoDeTurnosStore();
    const contexto = { origen: 'AGENDA', fecha: '2026-10-30' } as const;

    expect(flujo.solicitud()).toBeNull();

    flujo.nuevoTurno(contexto);
    expect(flujo.solicitud()).toEqual({ tipo: 'nuevo', contexto });

    flujo.programacionMultiple(contexto);
    expect(flujo.solicitud()).toEqual({ tipo: 'multiple', contexto });

    flujo.listaDeEspera(contexto);
    expect(flujo.solicitud()).toEqual({ tipo: 'espera', contexto });

    flujo.bloqueoDeAgenda(contexto);
    expect(flujo.solicitud()).toEqual({ tipo: 'bloqueo', contexto });

    flujo.verTurno(7);
    expect(flujo.solicitud()).toEqual({ tipo: 'detalle', turnoId: 7 });

    flujo.cerrar();
    expect(flujo.solicitud()).toBeNull();
  });

  it('notificar un cambio avisa a las pantallas sin tocar lo que está abierto', () => {
    const flujo = new FlujoDeTurnosStore();
    flujo.verTurno(7);
    const antes = flujo.cambios();

    flujo.notificarCambio();

    expect(flujo.cambios()).toBe(antes + 1);
    expect(flujo.solicitud()).toEqual({ tipo: 'detalle', turnoId: 7 });
  });
});
