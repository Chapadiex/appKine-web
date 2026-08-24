import { nuevaClaveDeIntento } from './clave-de-intento';

describe('nuevaClaveDeIntento', () => {
  it('genera claves distintas en cada llamada', () => {
    const claves = new Set([nuevaClaveDeIntento(), nuevaClaveDeIntento(), nuevaClaveDeIntento()]);

    expect(claves.size).toBe(3);
  });

  it('genera una clave no vacia', () => {
    expect(nuevaClaveDeIntento().length).toBeGreaterThan(10);
  });

  it('sigue generando claves sin WebCrypto disponible', () => {
    // El alta no puede quedar inutilizable en un navegador sin `crypto.randomUUID`: el
    // header Idempotency-Key es obligatorio y sin el no hay registro posible.
    vi.stubGlobal('crypto', {});
    try {
      const claves = new Set([nuevaClaveDeIntento(), nuevaClaveDeIntento()]);

      expect(claves.size).toBe(2);
      expect([...claves][0].length).toBeGreaterThan(10);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
