import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { EsperaPorLimite } from '../../../shared/utils/espera-por-limite';
import { traducirError, traducirYEsperar } from './auth-errors';

function problema(
  status: number,
  type: string | null,
  detail: string,
  reintentarEnSegundos: number | null = null,
): AkineHttpError {
  return new AkineHttpError(
    status,
    { ...(type === null ? {} : { type }), detail, status },
    false,
    reintentarEnSegundos,
  );
}

describe('traducirError', () => {
  it('traduce el 401 del login al mensaje unico de credenciales', () => {
    const traducido = traducirError(
      problema(401, 'https://akine.app/problems/invalid-credentials', 'Credenciales invalidas'),
    );

    expect(traducido.causa).toBe('credenciales');
    expect(traducido.mensaje).toBe('Email o contrasena incorrectos.');
  });

  it('da el MISMO resultado para credenciales malas, cuenta sin activar y cuenta bloqueada', () => {
    // ADR-0018: los tres casos llegan con el mismo status y el mismo cuerpo. Si esta prueba
    // se rompe es porque alguien intento distinguirlos, y eso reabre la enumeracion.
    const causas = [
      problema(401, 'https://akine.app/problems/invalid-credentials', 'Credenciales invalidas'),
      problema(401, 'https://akine.app/problems/invalid-credentials', 'Credenciales invalidas'),
      problema(401, 'https://akine.app/problems/invalid-credentials', 'Credenciales invalidas'),
    ].map((error) => traducirError(error));

    expect(new Set(causas.map((c) => c.mensaje)).size).toBe(1);
  });

  it('muestra el detail literal del backend ante un 400 de politica de contrasena', () => {
    const traducido = traducirError(
      problema(
        400,
        'https://akine.app/problems/validation-error',
        'La contrasena debe tener al menos 12 caracteres y un numero.',
      ),
    );

    expect(traducido.causa).toBe('validacion');
    expect(traducido.mensaje).toBe('La contrasena debe tener al menos 12 caracteres y un numero.');
  });

  it('ante invalid-token da la salida de pedir un enlace nuevo, con el texto de la pantalla', () => {
    const traducido = traducirError(
      problema(400, 'https://akine.app/problems/invalid-token', 'Token invalido'),
      { token: 'El enlace vencio. Pedi uno nuevo.' },
    );

    expect(traducido.causa).toBe('token');
    expect(traducido.mensaje).toBe('El enlace vencio. Pedi uno nuevo.');
  });

  it('ante un 429 SIN Retry-After no inventa un plazo: mensaje sin numero', () => {
    // Antes se usaba un piso de 60 s tomado de la nada. Un plazo inventado que no se
    // corresponde con el limite real del backend es peor que un mensaje sin numero: si el
    // limite era mas corto hace esperar de mas, y si era mas largo promete algo falso.
    const traducido = traducirError(
      problema(429, 'https://akine.app/problems/rate-limited', 'Demasiados intentos'),
    );

    expect(traducido.causa).toBe('limite');
    expect(traducido.segundosDeEspera).toBe(0);
    expect(traducido.mensaje).toContain('Demasiados intentos');
    expect(traducido.mensaje).not.toContain('segundos');
  });

  it('ante un 429 usa los segundos del header Retry-After que leyo el interceptor', () => {
    const traducido = traducirError(
      problema(429, 'https://akine.app/problems/rate-limited', 'Demasiados intentos', 12),
    );

    expect(traducido.segundosDeEspera).toBe(12);
    expect(traducido.mensaje).toContain('12 segundos');
  });

  it('redondea hacia arriba un Retry-After fraccionario: mejor esperar de mas que de menos', () => {
    expect(
      traducirError(problema(429, 'https://akine.app/problems/rate-limited', 'x', 4.2))
        .segundosDeEspera,
    ).toBe(5);
  });

  it('reconoce el limite por el problem type aunque el status no sea 429', () => {
    const traducido = traducirError(
      problema(503, 'https://akine.app/problems/rate-limited', 'Demasiados intentos', 30),
    );

    expect(traducido.causa).toBe('limite');
    expect(traducido.segundosDeEspera).toBe(30);
  });

  it('un 403 se traduce como falta de permiso, no como sesion perdida', () => {
    const traducido = traducirError(problema(403, null, 'No tenes permiso'));

    expect(traducido.causa).toBe('permiso');
    expect(traducido.mensaje).toBe('No tenes permiso');
  });

  it('distingue el fallo de red del error del servidor', () => {
    const traducido = traducirError(new AkineHttpError(0, null, true));

    expect(traducido.causa).toBe('red');
    expect(traducido.mensaje).toContain('No se pudo contactar al servidor');
  });

  it('ante un error que no es del interceptor no filtra nada tecnico', () => {
    const traducido = traducirError(new TypeError('undefined is not a function'));

    expect(traducido.causa).toBe('otro');
    expect(traducido.mensaje).not.toContain('undefined');
  });

  it('devuelve el mensaje del backend ante un 500', () => {
    const traducido = traducirError(problema(500, null, 'Fallo al encolar el correo'));

    expect(traducido.causa).toBe('otro');
    expect(traducido.mensaje).toBe('Fallo al encolar el correo');
  });
});

describe('traducirYEsperar', () => {
  it('arranca la cuenta regresiva cuando el backend declaro el plazo', () => {
    const espera = new EsperaPorLimite();

    traducirYEsperar(problema(429, 'https://akine.app/problems/rate-limited', 'x', 30), espera);

    expect(espera.activa()).toBe(true);
    expect(espera.segundos()).toBe(30);
    espera.detener();
  });

  it('sin plazo declarado no arranca ninguna cuenta regresiva', () => {
    const espera = new EsperaPorLimite();

    traducirYEsperar(problema(429, 'https://akine.app/problems/rate-limited', 'x'), espera);

    expect(espera.activa()).toBe(false);
  });

  it('un error que no es de limite deja la espera quieta y respeta los textos de pantalla', () => {
    const espera = new EsperaPorLimite();

    const traducido = traducirYEsperar(
      problema(400, 'https://akine.app/problems/invalid-token', 'x'),
      espera,
      { token: 'Pedi otro enlace.' },
    );

    expect(espera.activa()).toBe(false);
    expect(traducido.mensaje).toBe('Pedi otro enlace.');
  });
});
