import { vistaPreviaDe } from './vista-previa';

/**
 * La vista previa segura de adjuntos (D-a). La lista blanca es la unica defensa del lado del
 * cliente contra un archivo que se haga pasar por otra cosa, asi que se prueba lo que NO muestra.
 */
describe('vistaPreviaDe', () => {
  const con = (tipo: string) => new Blob(['contenido'], { type: tipo });

  it('muestra imagenes rasterizadas y PDF, con el tipo de la lista blanca', () => {
    expect(vistaPreviaDe(con('image/png'))?.como).toBe('imagen');
    expect(vistaPreviaDe(con('image/jpeg'))?.blob.type).toBe('image/jpeg');
    expect(vistaPreviaDe(con('application/pdf'))?.como).toBe('pdf');
  });

  it('no renderiza HTML, SVG, texto ni un Blob sin tipo: esos solo se descargan', () => {
    for (const tipo of ['text/html', 'image/svg+xml', 'text/plain', 'application/xml', '']) {
      expect(vistaPreviaDe(con(tipo)), tipo).toBeNull();
    }
  });
});
