/**
 * Clave de idempotencia de un intento de alta.
 *
 * <p>Varios `POST` de AKINE exigen el header `Idempotency-Key`: el alta self-service
 * (`/api/v1/auth/register`) y el alta de sede (`/api/v1/organizations/{orgId}/consultorios`).
 * Reintentar con la <b>misma</b> clave y el <b>mismo</b> cuerpo devuelve el mismo desenlace
 * en vez de crear un segundo recurso: es lo que cierra el doble submit y el reintento
 * despues de un corte de red.
 *
 * <p><b>Vive en `shared/utils` y no en un feature.</b> La usan `features/auth` y
 * `features/organization`, y un feature no importa de otro (AGENT.md seccion 4). No hay
 * nada de dominio aca: genera un identificador opaco y no sabe para que endpoint es.
 *
 * <p><b>La clave identifica el INTENTO, no la llamada.</b> Quien la usa la genera una sola
 * vez por intento y la reusa en los reintentos. Si el usuario cambia el cuerpo hace falta
 * una clave nueva: el backend responde `409 idempotency-key-conflict` ante la misma clave
 * con otro contenido.
 */
export function nuevaClaveDeIntento(): string {
  const generador = globalThis.crypto;
  if (typeof generador?.randomUUID === 'function') {
    return generador.randomUUID();
  }

  // Respaldo para entornos sin WebCrypto. No es criptografico y no hace falta que lo sea:
  // la clave solo tiene que ser unica por intento, no impredecible.
  const azar = () =>
    Math.floor(Math.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0');
  return `${azar()}-${azar()}-${azar()}-${azar()}`;
}
