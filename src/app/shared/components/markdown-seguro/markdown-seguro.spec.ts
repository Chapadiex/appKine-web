import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { MarkdownSeguro } from './markdown-seguro';

const FICHA = [
  '## Para qué sirve',
  '',
  'Es el cajón de **la sede**. Ver [Egresos](/egresos) o [afuera](https://ejemplo.test).',
  '',
  '## Tareas',
  '',
  '### Abrir la caja',
  '![La caja cerrada](captura:caja-diaria/abrir-caja)',
  '1. Entrá a :icono[economia]: **Caja diaria**.',
  '2. Tocá **Abrir la caja** ②.',
  '3. Mirá :icono[para-que-sirve]: y :icono[no-existe]:.',
  '',
  '- un punto suelto',
  '',
  '> [!importante]',
  '> No se revierte.',
  '',
  '> [!consejo]',
  '> Usá el buscador.',
].join('\n');

describe('MarkdownSeguro', () => {
  function crear(markdown: string) {
    TestBed.configureTestingModule({ imports: [MarkdownSeguro], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(MarkdownSeguro);
    fixture.componentRef.setInput('markdown', markdown);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('dibuja secciones, tareas, pasos, listas y avisos sin innerHTML', () => {
    const { el } = crear(FICHA);

    expect(el.querySelector('.manual__seccion')?.textContent).toContain('Para qué sirve');
    expect(el.querySelector('.manual__seccion app-icono')).not.toBeNull();
    expect(el.querySelector('.manual__tarea')?.textContent).toContain('Abrir la caja');
    expect(el.querySelectorAll('.manual__pasos li')).toHaveLength(3);
    expect(el.querySelectorAll('ul li')).toHaveLength(1);
    // El navegador colapsa los espacios: se compara el texto como se ve.
    const aviso =
      el.querySelector('.manual__aviso:not(.manual__aviso--consejo)')?.textContent ?? '';
    expect(aviso.replace(/\s+/g, ' ')).toContain('Importante: No se revierte.');
    expect(el.querySelector('.manual__aviso--consejo')?.textContent).toContain('Consejo:');
  });

  it('enlaza sólo rutas internas y deja lo externo como texto', () => {
    const { el } = crear(FICHA);

    const enlaces = Array.from(el.querySelectorAll('a'));
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual(['/egresos']);
    expect(el.textContent).toContain('[afuera](https://ejemplo.test)');
  });

  it('muestra los íconos conocidos, el número de la marca y omite los desconocidos', () => {
    const { el } = crear(FICHA);

    // economia (de la app) y para-que-sirve (del manual); no-existe no se dibuja.
    expect(el.querySelectorAll('.manual__pasos app-icono')).toHaveLength(2);
    expect(el.querySelector('.manual__marca')?.getAttribute('aria-label')).toBe('marca 2');
    expect(el.textContent).not.toContain(':icono[');
  });

  it('amplía la captura al tocarla y la oculta si no se pudo cargar', () => {
    const { fixture, el } = crear(FICHA);
    const ampliadas: { src: string; alt: string }[] = [];
    fixture.componentInstance.ampliar.subscribe((c) => ampliadas.push(c));

    const boton = el.querySelector<HTMLButtonElement>('.manual__captura')!;
    expect(boton.querySelector('img')?.getAttribute('src')).toBe(
      '/manual/caja-diaria/abrir-caja.png',
    );
    boton.click();
    expect(ampliadas).toEqual([
      { src: '/manual/caja-diaria/abrir-caja.png', alt: 'La caja cerrada' },
    ]);

    boton.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();
    expect(el.querySelector('.manual__captura')).toBeNull();
  });
});
