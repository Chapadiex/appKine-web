import {
  PALETAS_DE_MARCA,
  REFERENCIA_DE_TEMA,
  TemaDeMarca,
  ajustarIntensidad,
  colorPorDefecto,
  contraste,
  esColor,
  textoSobre,
  tokensDeMarca,
  tonoConContraste,
} from './color-de-marca';

describe('color de marca', () => {
  it('mide el contraste de WCAG', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contraste('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('las paletas sugeridas se leen en su tema: principal 3:1 y acento 4,5:1', () => {
    for (const paleta of PALETAS_DE_MARCA) {
      for (const tema of ['claro', 'oscuro'] as TemaDeMarca[]) {
        const { principal, acento } = paleta[tema];
        const fondo = REFERENCIA_DE_TEMA[tema].superficie;
        if (principal !== null) {
          expect(
            contraste(principal, fondo),
            `${paleta.nombre} principal ${tema}`,
          ).toBeGreaterThanOrEqual(3);
          // El texto del boton lo elige la aplicacion y tiene que leerse siempre.
          expect(
            contraste(principal, textoSobre(principal)),
            `${paleta.nombre} texto sobre principal ${tema}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
        if (acento !== null) {
          expect(
            contraste(acento, fondo),
            `${paleta.nombre} acento ${tema}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('sugiere el tono mas cercano que llega al contraste pedido', () => {
    const amarillo = '#fde047';
    const sugerido = tonoConContraste(amarillo, '#ffffff', 4.5);
    expect(contraste(amarillo, '#ffffff')).toBeLessThan(4.5);
    expect(contraste(sugerido, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // Un color que ya llega no se toca.
    expect(tonoConContraste('#0f766e', '#ffffff', 4.5)).toBe('#0f766e');
  });

  it('mas fuerte oscurece y mas suave aclara', () => {
    const base = '#0f766e';
    expect(contraste(ajustarIntensidad(base, 0.12), '#ffffff')).toBeGreaterThan(
      contraste(base, '#ffffff'),
    );
    expect(contraste(ajustarIntensidad(base, -0.12), '#ffffff')).toBeLessThan(
      contraste(base, '#ffffff'),
    );
  });

  it('un tema sin colores propios no pisa ningun token', () => {
    expect(tokensDeMarca({ principal: null, acento: null }, 'claro')).toEqual({});
    expect(tokensDeMarca({ principal: 'rojo', acento: '#12' }, 'claro')).toEqual({});
  });

  it('el principal pinta la accion con un texto legible, y el acento los enlaces', () => {
    const tokens = tokensDeMarca({ principal: '#fde047', acento: '#115e59' }, 'claro');
    expect(tokens['--color-accion-fondo']).toBe('#fde047');
    // Sobre amarillo el texto es el oscuro, no el blanco.
    expect(tokens['--color-accion-texto']).toBe('#101820');
    expect(tokens['--color-enlace']).toBe('#115e59');
    // La barra lateral y la superior se tiñen con el principal, mezclado con la superficie.
    expect(tokens['--color-marca-fondo']).toContain('#fde047 12%');
    expect(tokens['--color-cabecera-fondo']).toContain('#fde047 7%');
    expect(esColor(tokens['--color-acento'])).toBe(true);
  });

  it('una zona con color propio le gana al tinte y lleva encima un texto que se lee', () => {
    const tokens = tokensDeMarca(
      {
        principal: '#0f766e',
        acento: null,
        barraLateral: '#0b3b37',
        cabecera: '#fde047',
        fondo: '#f0fdfa',
        tarjeta: '#fffbeb',
        pie: '#0b3b37',
        botonSecundario: '#fde047',
      },
      'claro',
    );
    expect(tokens['--color-marca-fondo']).toBe('#0b3b37');
    expect(tokens['--color-marca-texto']).toBe('#ffffff');
    expect(contraste(tokens['--color-marca-texto-suave'], '#0b3b37')).toBeGreaterThanOrEqual(4.5);
    expect(tokens['--color-cabecera-fondo']).toBe('#fde047');
    expect(tokens['--color-cabecera-texto']).toBe('#101820');
    expect(tokens['--color-superficie-sutil']).toBe('#f0fdfa');
    expect(tokens['--color-superficie']).toBe('#fffbeb');
    expect(tokens['--color-pie-fondo']).toBe('#0b3b37');
    expect(tokens['--color-pie-texto']).toBe('#ffffff');
    // El contorno queda del color elegido; el texto se oscurece hasta leerse.
    expect(tokens['--color-secundario-borde']).toBe('#fde047');
    expect(contraste(tokens['--color-secundario-texto'], '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('una zona sin color propio muestra el que sale del principal', () => {
    const sinMarca = { principal: null, acento: null };
    expect(colorPorDefecto(sinMarca, 'claro', 'barraLateral')).toBe('#ffffff');
    expect(colorPorDefecto(sinMarca, 'oscuro', 'fondo')).toBe('#101820');
    const conMarca = { principal: '#0f766e', acento: null };
    expect(colorPorDefecto(conMarca, 'claro', 'botonSecundario')).toBe('#0f766e');
    expect(colorPorDefecto(conMarca, 'claro', 'barraLateral')).not.toBe('#ffffff');
  });
});
