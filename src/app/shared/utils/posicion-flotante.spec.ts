import { posicionFlotante } from './posicion-flotante';

const VENTANA = { ancho: 1280, alto: 800 };

/** Un "?" de 24 px con su esquina superior izquierda en (x, y). */
const boton = (x: number, y: number) => ({ left: x, top: y, right: x + 24, bottom: y + 24 });

describe('posicionFlotante', () => {
  it('con lugar, abre a la derecha y centrado en el boton', () => {
    const posicion = posicionFlotante(boton(100, 300), 340, 200, VENTANA);

    expect(posicion).toEqual({
      lado: 'derecha',
      top: 212,
      left: 134,
      altoMaximo: null,
      flecha: 100,
    });
  });

  it('cerca del borde derecho (el "?" de un panel lateral) abre a la izquierda', () => {
    const posicion = posicionFlotante(boton(1200, 300), 340, 200, VENTANA);

    expect(posicion.lado).toBe('izquierda');
    expect(posicion.left).toBe(1200 - 10 - 340);
  });

  it('sin lugar a los costados abre abajo y se corre para no tocar el borde', () => {
    const telefono = { ancho: 375, alto: 800 };
    const posicion = posicionFlotante(boton(330, 100), 355, 200, telefono);

    expect(posicion.lado).toBe('abajo');
    expect(posicion.left).toBe(375 - 10 - 355);
    // La flecha sigue apuntando al centro del boton, no al del panel.
    expect(posicion.flecha).toBe(330 + 12 - posicion.left);
  });

  it('al pie de la ventana abre arriba', () => {
    const posicion = posicionFlotante(boton(330, 700), 355, 200, { ancho: 375, alto: 800 });

    expect(posicion.lado).toBe('arriba');
    expect(posicion.top).toBe(700 - 10 - 200);
  });

  it('si no entra en ningun lado, va donde hay mas alto y lo acota', () => {
    const posicion = posicionFlotante(boton(330, 100), 355, 600, { ancho: 375, alto: 500 });

    expect(posicion.lado).toBe('abajo');
    expect(posicion.altoMaximo).toBe(500 - 10 - (124 + 10));
  });
});
