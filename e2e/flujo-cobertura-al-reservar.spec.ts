import {
  RESERVA,
  abrirReserva,
  avisos,
  expect,
  ingresar,
  respuestaDe,
  test,
} from './support/agenda-real';
import {
  crearFinanciador,
  crearOferta,
  crearPersona,
  darCobertura,
  diaDeTrabajo,
  fechaLocal,
  sumarDias,
} from './support/sembrado';
import { DIAS_PANTALLAS_098 } from './support/sembrado-pantallas-098';

/**
 * E2E de la cobertura elegida al reservar (web #74, api #107: `ReservarTurno.coberturaId`) contra el
 * backend REAL.
 *
 * <p>La persona tiene una cobertura FINANCIADA vigente. Al elegirla en la reserva, el panel tiene que
 * ofrecerla en el selector y mandarla en el pedido, y el turno leido despues por la API tiene que
 * tenerla guardada: un 201 no prueba que haya quedado.
 */

test.describe('Cobertura elegida al reservar contra el backend real', () => {
  test('el turno reservado muestra la cobertura elegida y el backend la guarda', async ({
    page,
    api,
    centro,
  }, info) => {
    const desde = sumarDias(fechaLocal(centro.timezone), -30);
    const oferta = await crearOferta(api, centro);
    const persona = await crearPersona(api);
    const financiador = await crearFinanciador(api, desde);
    const coberturaId = await darCobertura(api, persona, financiador, desde);

    const { fecha, slots } = await diaDeTrabajo(
      api,
      centro,
      oferta.id,
      DIAS_PANTALLAS_098.coberturaAlReservar,
    );
    // El CI reintenta: el reintento encuentra al profesional ocupado en el horario del intento
    // anterior (otra oferta, mismo profesional), asi que cada intento toma otro horario.
    const slot = slots[info.retry * 2];
    expect(slot, `quedan horarios en ${fecha}`).toBeDefined();

    await ingresar(page, centro);
    const panel = await abrirReserva(page, centro, oferta, fecha, slot, persona);

    // La cobertura es opcional: va plegada en "Más opciones".
    await panel.getByText('Más opciones').click();
    const selector = panel.getByLabel('Cobertura con la que se piensa atender (opcional)');
    await expect(selector.locator(`option[value="${coberturaId}"]`)).toContainText(
      financiador.nombre,
    );
    await expect(selector).toHaveValue('');
    await selector.selectOption(String(coberturaId));

    const creado = respuestaDe(page, 'POST', RESERVA);
    await panel.getByRole('button', { name: 'Confirmar turno' }).click();
    const respuesta = await creado;
    expect(respuesta.status(), await respuesta.text()).toBe(201);
    expect(respuesta.request().postDataJSON()).toMatchObject({ coberturaId });
    const { id: turnoId } = (await respuesta.json()) as { id: number };

    await expect(avisos(page).getByText('Turno creado correctamente.')).toBeVisible();

    // --- El backend la guardo con el turno --------------------------------------------------
    // `GET /turnos/{id}` (TurnoDelDia) no publica `coberturaId`; el `Turno` entero lo devuelven las
    // transiciones. Confirmar es idempotente, no cambia la cobertura y relee la fila guardada.
    const guardado = await api.exigir<{ coberturaId?: number; personaId: number; inicio: string }>(
      'POST',
      `/api/v1/consultorios/${centro.consultorioId}/turnos/${turnoId}/confirmacion`,
    );
    expect(guardado.coberturaId).toBe(coberturaId);
    expect(guardado.personaId).toBe(persona.id);
    expect(guardado.inicio).toBe(slot.desde);
  });
});
