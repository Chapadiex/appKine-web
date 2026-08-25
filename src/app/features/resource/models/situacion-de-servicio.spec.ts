import { EspacioResponseEstadoEnum } from '../../../api/generated/model/espacio-response';
import { situacionDeServicio } from './situacion-de-servicio';

// Los dos estados salen del enum generado, no de literales: el compilador es quien tiene que
// avisar si el contrato renombra uno.
const ACTIVO = EspacioResponseEstadoEnum.ACTIVO;
const INACTIVO = EspacioResponseEstadoEnum.INACTIVO;

const AHORA = new Date('2026-08-25T12:00:00Z');

/**
 * Spec de la distincion que da sentido a toda la etapa (M04, RN-M04-002).
 *
 * <p>Se cubre <b>solo</b> lo que la pantalla no puede aplanar: que un espacio con
 * `estado = ACTIVO` y `enServicio = false` reciba un resumen distinto del de uno operativo
 * <b>y</b> una explicacion del motivo. Si esa rama se rompe, no falla nada visible: la fila
 * se ve igual que la de un box en servicio, el box no aparece en el selector de reserva, y el
 * bug se reporta contra la agenda, que no tiene la culpa.
 *
 * <p>No hay un `it` por cada combinacion de fechas: los tres casos "activo sin servicio"
 * comparten la misma salida estructural y solo cambia el texto. Lo que importa es que ninguno
 * de ellos se confunda con `en-servicio` ni con `dado-de-baja`.
 */
describe('situacionDeServicio', () => {
  it('un espacio activo que entra en servicio despues explica por que no se ofrece todavia', () => {
    const situacion = situacionDeServicio(
      {
        estado: ACTIVO,
        enServicio: false,
        validFrom: '2026-09-01T00:00:00Z',
      },
      AHORA,
    );

    expect(situacion.clave).toBe('aun-no');
    // El resumen NO puede ser solo "Activo": eso lo vuelve indistinguible de un box operativo.
    expect(situacion.resumen).not.toBe('Activo y en servicio');
    expect(situacion.resumen).toContain('sin servicio');
    // Y la explicacion tiene que decir la fecha y por que no aparece en los selectores.
    expect(situacion.explicacion).toContain('Entra en servicio');
    expect(situacion.explicacion).toContain('no aparece en los selectores de reserva');
    expect(situacion.atenuada).toBe(true);
  });

  it('un espacio activo cuya vigencia ya termino manda a editar el fin, no a darlo de baja', () => {
    const situacion = situacionDeServicio(
      {
        estado: ACTIVO,
        enServicio: false,
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2026-06-30T00:00:00Z',
      },
      AHORA,
    );

    expect(situacion.clave).toBe('ya-no');
    expect(situacion.explicacion).toContain('su vigencia termino');
    // La salida es la ventana, no un alta nueva: decirle que lo vuelva a crear duplicaria el
    // recurso y romperia la trazabilidad de lo que ya paso en el.
    expect(situacion.explicacion).toContain('edita el fin de vigencia');
  });

  it('en servicio y dado de baja no llevan explicacion: no hay nada raro que aclarar', () => {
    const operativo = situacionDeServicio({ estado: ACTIVO, enServicio: true }, AHORA);
    const debaja = situacionDeServicio({ estado: INACTIVO, enServicio: false }, AHORA);

    expect(operativo.clave).toBe('en-servicio');
    expect(operativo.explicacion).toBeNull();
    expect(operativo.atenuada).toBe(false);

    // La baja gana sobre la ventana: un espacio dado de baja no esta "fuera de vigencia", esta
    // dado de baja, y su motivo lo muestra la fila aparte.
    expect(debaja.clave).toBe('dado-de-baja');
    expect(debaja.explicacion).toBeNull();
  });

  it('la autoridad es enServicio del backend, no el reloj del navegador', () => {
    // Ventana ya vencida segun las fechas, pero el backend dice que esta en servicio. Gana el
    // backend: el reloj del cliente puede estar corrido y no es quien decide.
    const situacion = situacionDeServicio(
      {
        estado: ACTIVO,
        enServicio: true,
        validUntil: '2020-01-01T00:00:00Z',
      },
      AHORA,
    );

    expect(situacion.clave).toBe('en-servicio');
  });
});
