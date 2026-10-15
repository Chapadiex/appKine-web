import { nombreDeContentDisposition, tamanoEnPalabras } from './archivos';

describe('nombreDeContentDisposition', () => {
  it('prefiere la forma extendida, sin importar mayusculas, y cae en la simple', () => {
    expect(nombreDeContentDisposition('attachment; filename="placa.png"')).toBe('placa.png');
    expect(
      nombreDeContentDisposition(
        `attachment; filename="x.pdf"; filename*=utf-8''informe%20rodilla.pdf`,
      ),
    ).toBe('informe rodilla.pdf');
    expect(
      nombreDeContentDisposition(`attachment; filename*=UTF-8''%E0%A4%A; filename="b.pdf"`),
    ).toBe('b.pdf');
  });

  it('saca las barras para que el nombre no proponga una ruta, y sin nombre devuelve null', () => {
    expect(nombreDeContentDisposition('attachment; filename="../../etc/passwd"')).toBe(
      '....etcpasswd',
    );
    expect(nombreDeContentDisposition('attachment; filename="/"')).toBeNull();
    expect(nombreDeContentDisposition(null)).toBeNull();
  });
});

describe('tamanoEnPalabras', () => {
  it('formatea en es-AR y descarta lo que no es un tamano', () => {
    expect(tamanoEnPalabras(512)).toBe('512 B');
    expect(tamanoEnPalabras(8_808_038)).toBe('8,4 MB');
    expect(tamanoEnPalabras(-1)).toBe('');
  });
});
