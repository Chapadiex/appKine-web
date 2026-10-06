import { HttpErrorResponse } from '@angular/common/http';

import { traducirErrorCaso } from './casos-errors';

/**
 * Spec de `traducirErrorCaso`: la tabla de rechazos del backend a la causa de dominio.
 *
 * <p>Cada causa cambia lo que la pantalla ofrece hacer (releer y reintentar, confirmar un
 * duplicado, no reintentar), asi que confundir dos rechazos no es cosmetico: deja al profesional
 * sin la accion correcta. Se testea la causa, no el texto exacto del mensaje.
 *
 * <p>BLOQUEADO (spec): `traducirErrorCaso` devuelve 'otro' para TODA forma de entrada que este
 * nodo puede construir sin ver la implementacion: `HttpErrorResponse` por status (0/400/403/404),
 * por `.error.type` (URL completa y slug pelado), por `.error.problemType`, y objetos planos
 * equivalentes. La forma real que reconoce la produce el `errorInterceptor` en la capa HTTP, que el
 * encargo ("mockear CasosApi, sin HTTP") deja fuera de alcance. Estos casos quedan en `skip` hasta
 * que el padre agregue `casos-errors.ts` (+ el interceptor / tipo de error) a las Ubicaciones, o
 * autorice testear errores por el pipeline HTTP real como hace `atencion-page.spec.ts`.
 */
describe('traducirErrorCaso', () => {
  function problema(status: number, slug?: string): HttpErrorResponse {
    return new HttpErrorResponse({
      status,
      statusText: String(status),
      error: slug ? { type: `https://akine.app/problems/${slug}`, status, detail: 'detalle' } : {},
    });
  }

  it.skip('un 409 concurrent-modification es version-vieja: se relee y se reintenta', () => {
    const r = traducirErrorCaso(problema(409, 'concurrent-modification'));
    expect(r.causa).toBe('version-vieja');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it.skip('un 409 caso-clinico-posible-duplicado es posible-duplicado: se confirma, no se reintenta a ciegas', () => {
    const r = traducirErrorCaso(problema(409, 'caso-clinico-posible-duplicado'));
    expect(r.causa).toBe('posible-duplicado');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it.skip('un 400 de validacion es validacion', () => {
    const r = traducirErrorCaso(problema(400, 'validation-error'));
    expect(r.causa).toBe('validacion');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it.skip('un 403 es sin-permiso', () => {
    const r = traducirErrorCaso(problema(403));
    expect(r.causa).toBe('sin-permiso');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it.skip('un 404 es no-encontrado', () => {
    const r = traducirErrorCaso(problema(404));
    expect(r.causa).toBe('no-encontrado');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it.skip('un fallo de red (status 0) es red', () => {
    const r = traducirErrorCaso(
      new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }),
    );
    expect(r.causa).toBe('red');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it('algo que no es un error HTTP cae en otro, sin romperse', () => {
    expect(traducirErrorCaso(new Error('boom')).causa).toBe('otro');
    expect(traducirErrorCaso(undefined).causa).toBe('otro');
    expect(traducirErrorCaso({ cualquier: 'cosa' }).causa).toBe('otro');
  });
});
