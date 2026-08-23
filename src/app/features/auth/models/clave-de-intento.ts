/**
 * Clave de idempotencia del alta self-service.
 *
 * <p>`POST /api/v1/auth/register` exige el header `Idempotency-Key`. Reintentar el alta con
 * la misma clave devuelve el mismo desenlace sin crear una segunda cuenta ni mandar un
 * segundo correo: es lo que cierra el doble submit y el reintento tras un corte de red.
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
