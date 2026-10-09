import { traducirErrorCaso } from './casos-errors';
import { AkineHttpError, ProblemDetail } from '../../../core/interceptors/error.interceptor';

/**
 * Spec de `traducirErrorCaso`: la tabla de rechazos del backend a la causa de dominio.
 *
 * <p>Cada causa cambia lo que la pantalla ofrece hacer (releer y reintentar, confirmar un
 * duplicado, no reintentar), asi que confundir dos rechazos no es cosmetico: deja al profesional
 * sin la accion correcta. Se testea la causa, no el texto exacto del mensaje.
 *
 * <p>La entrada es un `AkineHttpError` (lo que produce el `errorInterceptor` y lo que emiten las
 * operaciones de `CasosApi`): la funcion ignora cualquier otra forma. El `problemType` sale del
 * ultimo segmento de `type` y gana sobre el status; sin `problemType` conocido, decide el status.
 */
describe('traducirErrorCaso', () => {
  function akine(status: number, slug?: string, esDeRed = false): AkineHttpError {
    const problem: ProblemDetail | null = slug
      ? { type: `https://akine.app/problems/${slug}`, status, detail: 'detalle del backend' }
      : null;
    return new AkineHttpError(status, problem, esDeRed);
  }

  it('un 409 concurrent-modification es version-vieja: se relee y se reintenta', () => {
    const r = traducirErrorCaso(akine(409, 'concurrent-modification'));
    expect(r.causa).toBe('version-vieja');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it('un 409 caso-clinico-posible-duplicado es posible-duplicado: se confirma, no se reintenta a ciegas', () => {
    const r = traducirErrorCaso(akine(409, 'caso-clinico-posible-duplicado'));
    expect(r.causa).toBe('posible-duplicado');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it('un 409 sin problemType propio es caso-cerrado: no se reintenta', () => {
    const r = traducirErrorCaso(akine(409));
    expect(r.causa).toBe('caso-cerrado');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it('missing-tenant-context es sin-contexto, y gana sobre el status', () => {
    const r = traducirErrorCaso(akine(403, 'missing-tenant-context'));
    expect(r.causa).toBe('sin-contexto');
  });

  it('subscription-suspended es suscripcion-suspendida', () => {
    const r = traducirErrorCaso(akine(409, 'subscription-suspended'));
    expect(r.causa).toBe('suscripcion-suspendida');
  });

  it('caso-sin-motivo-de-cierre es validacion', () => {
    const r = traducirErrorCaso(akine(409, 'caso-sin-motivo-de-cierre'));
    expect(r.causa).toBe('validacion');
  });

  it('un 400 sin slug es validacion', () => {
    const r = traducirErrorCaso(akine(400));
    expect(r.causa).toBe('validacion');
  });

  it('un 403 sin slug es sin-permiso', () => {
    const r = traducirErrorCaso(akine(403));
    expect(r.causa).toBe('sin-permiso');
  });

  it('un 404 es no-encontrado', () => {
    const r = traducirErrorCaso(akine(404));
    expect(r.causa).toBe('no-encontrado');
  });

  it('un 429 es limite', () => {
    const r = traducirErrorCaso(akine(429));
    expect(r.causa).toBe('limite');
  });

  it('un fallo de red es red, sin importar el status', () => {
    const r = traducirErrorCaso(akine(0, undefined, true));
    expect(r.causa).toBe('red');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it('algo que no es un AkineHttpError cae en otro, sin romperse', () => {
    expect(traducirErrorCaso(new Error('boom')).causa).toBe('otro');
    expect(traducirErrorCaso(undefined).causa).toBe('otro');
    expect(traducirErrorCaso({ status: 404 }).causa).toBe('otro');
  });
});
