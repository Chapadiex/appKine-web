import { parsearTextoDelAgente, personasEnlazadas } from './texto-del-agente';

describe('parsearTextoDelAgente', () => {
  it('separaParrafosYListas', () => {
    const bloques = parsearTextoDelAgente(
      'Hoy vienen dos:\n- Ana a las 9\n- Juan a las 10\n\nY una clase.\n1. Yoga\n2. Pilates',
    );

    expect(bloques).toEqual([
      { tipo: 'parrafo', tramos: [{ tipo: 'texto', texto: 'Hoy vienen dos:' }] },
      {
        tipo: 'lista',
        items: [
          [{ tipo: 'texto', texto: 'Ana a las 9' }],
          [{ tipo: 'texto', texto: 'Juan a las 10' }],
        ],
      },
      { tipo: 'parrafo', tramos: [{ tipo: 'texto', texto: 'Y una clase.' }] },
      {
        tipo: 'lista-ordenada',
        items: [[{ tipo: 'texto', texto: 'Yoga' }], [{ tipo: 'texto', texto: 'Pilates' }]],
      },
    ]);
  });

  it('marcaNegritas', () => {
    expect(parsearTextoDelAgente('Debe **$ 12.000** desde octubre.')).toEqual([
      {
        tipo: 'parrafo',
        tramos: [
          { tipo: 'texto', texto: 'Debe ' },
          { tipo: 'negrita', texto: '$ 12.000' },
          { tipo: 'texto', texto: ' desde octubre.' },
        ],
      },
    ]);
  });

  it('enlazaRutasInternasConEtiquetaYSueltas', () => {
    const [bloque] = parsearTextoDelAgente(
      'Ver [la ficha de Ana](/pacientes/12) o /agenda?fecha=2026-11-23, y no 10/11.',
    );

    expect(bloque).toEqual({
      tipo: 'parrafo',
      tramos: [
        { tipo: 'texto', texto: 'Ver ' },
        { tipo: 'enlace', texto: 'la ficha de Ana', ruta: '/pacientes/12', query: null },
        { tipo: 'texto', texto: ' o ' },
        {
          tipo: 'enlace',
          texto: '/agenda?fecha=2026-11-23',
          ruta: '/agenda',
          query: { fecha: '2026-11-23' },
        },
        { tipo: 'texto', texto: ', y no 10/11.' },
      ],
    });
  });

  it('noEnlazaDestinosExternosNiJavascript', () => {
    const [bloque] = parsearTextoDelAgente(
      '[uno](https://malo.example) [dos](javascript:alert(1)) [tres](//malo.example)',
    );

    expect(bloque.tipo === 'parrafo' && bloque.tramos.some((t) => t.tipo === 'enlace')).toBe(false);
  });

  it('dejaElMarcadoHtmlComoTexto', () => {
    const [bloque] = parsearTextoDelAgente('<img src=x onerror=alert(1)> **<b>hola</b>**');

    expect(bloque).toEqual({
      tipo: 'parrafo',
      tramos: [
        { tipo: 'texto', texto: '<img src=x onerror=alert(1)> ' },
        { tipo: 'negrita', texto: '<b>hola</b>' },
      ],
    });
  });

  it('juntaLasPersonasEnlazadasSinRepetir', () => {
    const bloques = parsearTextoDelAgente(
      '- [Ana](/pacientes/12)\n- [Ana otra vez](/pacientes/12)\n\nY /personas/7.',
    );

    expect(personasEnlazadas(bloques)).toEqual([12, 7]);
  });
});
