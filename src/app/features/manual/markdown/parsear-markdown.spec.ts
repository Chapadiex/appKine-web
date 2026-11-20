import { parsearInline, parsearMarkdown } from './parsear-markdown';

describe('parsearMarkdown', () => {
  it('separa título, lista ordenada y aviso', () => {
    const bloques = parsearMarkdown(
      [
        '### Abrir la caja',
        '1. Entrá a **Caja diaria**.',
        '2. Tocá **Abrir la caja** ②.',
        '',
        '> [!importante]',
        '> Un cierre no se revierte.',
      ].join('\n'),
    );

    expect(bloques.map((b) => b.tipo)).toEqual(['titulo', 'lista-ordenada', 'aviso']);
    const lista = bloques[1];
    expect(lista.tipo === 'lista-ordenada' && lista.items).toHaveLength(2);
    expect(lista.tipo === 'lista-ordenada' && lista.items[1]).toContainEqual({ tipo: 'marca', numero: 2 });
    const aviso = bloques[2];
    expect(aviso.tipo === 'aviso' && aviso.variante).toBe('importante');
  });

  it('reconoce ícono y captura', () => {
    expect(parsearInline('Tocá :icono[filtro]: para filtrar')).toContainEqual({ tipo: 'icono', nombre: 'filtro' });
    expect(parsearMarkdown('![La caja cerrada](captura:caja-diaria/abrir-caja)')).toEqual([
      { tipo: 'captura', ficha: 'caja-diaria', nombre: 'abrir-caja', alt: 'La caja cerrada' },
    ]);
  });

  it('deja el HTML como texto literal', () => {
    const html = '<img src=x onerror="alert(1)">';

    expect(parsearMarkdown(html)).toEqual([{ tipo: 'parrafo', contenido: [{ tipo: 'texto', texto: html }] }]);
  });

  it('deja un enlace externo o con esquema como texto', () => {
    expect(parsearInline('[sitio](https://ejemplo.test)')).toEqual([
      { tipo: 'texto', texto: '[sitio](https://ejemplo.test)' },
    ]);
    expect(parsearInline('[x](javascript:alert(1))')[0].tipo).toBe('texto');
    expect(parsearInline('[Egresos](/egresos)')).toEqual([{ tipo: 'enlace', ruta: '/egresos', texto: 'Egresos' }]);
  });
});
