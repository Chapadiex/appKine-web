import { TestBed } from '@angular/core/testing';

import { Avisos } from './avisos';
import { AvisosStore } from '../../core/services/avisos.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../core/testing/axe';

/**
 * El contenedor de avisos: dibuja severidad con icono y texto, anuncia errores como alerta, cierra
 * y ejecuta la accion contextual.
 */
describe('Avisos', () => {
  function montar() {
    const fixture = TestBed.createComponent(Avisos);
    fixture.detectChanges();
    return {
      fixture,
      html: fixture.nativeElement as HTMLElement,
      store: TestBed.inject(AvisosStore),
    };
  }

  it('existe como region aunque no haya avisos, para que el lector la tenga registrada', () => {
    const { html } = montar();
    expect(html.getAttribute('role')).toBe('region');
    expect(html.getAttribute('aria-label')).toBe('Notificaciones');
    expect(html.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  it('un exito se lee con su severidad y no es una alerta', () => {
    const { fixture, html, store } = montar();
    store.exito('Persona registrada correctamente');
    fixture.detectChanges();

    const aviso = html.querySelector('.aviso--exito')!;
    expect(aviso.getAttribute('role')).toBeNull();
    expect(aviso.textContent).toContain('Listo:');
    expect(aviso.textContent).toContain('Persona registrada correctamente');
  });

  it('un error con accion es una alerta, y la accion se ejecuta y lo cierra', () => {
    const { fixture, html, store } = montar();
    let reintentos = 0;
    store.error('No pudimos guardar los cambios', {
      descripcion: 'El servidor no respondió.',
      accion: { etiqueta: 'Reintentar', ejecutar: () => reintentos++ },
    });
    fixture.detectChanges();

    const aviso = html.querySelector('.aviso--error')!;
    expect(aviso.getAttribute('role')).toBe('alert');
    expect(aviso.textContent).toContain('El servidor no respondió.');
    aviso.querySelector<HTMLButtonElement>('.aviso__accion')!.click();
    fixture.detectChanges();

    expect(reintentos).toBe(1);
    expect(html.querySelector('.aviso')).toBeNull();
  });

  it('la otra salida también se ejecuta y lo cierra: "Ver turno" y "Crear otro"', () => {
    const { fixture, html, store } = montar();
    const usadas: string[] = [];
    store.exito('Turno creado correctamente.', {
      accion: { etiqueta: 'Ver turno', ejecutar: () => usadas.push('ver') },
      otraAccion: { etiqueta: 'Crear otro', ejecutar: () => usadas.push('otro') },
    });
    fixture.detectChanges();

    const acciones = html.querySelectorAll<HTMLButtonElement>('.aviso__accion');
    expect(Array.from(acciones).map((a) => a.textContent?.trim())).toEqual([
      'Ver turno',
      'Crear otro',
    ]);
    acciones[1].click();
    fixture.detectChanges();

    expect(usadas).toEqual(['otro']);
    expect(html.querySelector('.aviso')).toBeNull();
  });

  it('el boton de cerrar lo saca', () => {
    const { fixture, html, store } = montar();
    store.info('Agenda actualizada');
    fixture.detectChanges();

    html.querySelector<HTMLButtonElement>('.aviso__cerrar')!.click();
    fixture.detectChanges();
    expect(store.avisos()).toHaveLength(0);
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const { fixture, html, store } = montar();
      store.exito('Cambios guardados');
      store.advertencia('Hay horarios sin profesionales asignados');
      store.error('No pudimos guardar los cambios', {
        accion: { etiqueta: 'Reintentar', ejecutar: () => undefined },
      });
      fixture.detectChanges();
      await esperarSinViolaciones(html);
    },
    TIMEOUT_AXE,
  );
});
