import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { FuncionesIaStore } from '../../../core/services/funciones-ia.store';
import { ManualStore } from '../../../core/services/manual.store';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { PreguntaAlAsistenteStore } from '../../../core/services/pregunta-al-asistente.store';
import { SessionService } from '../../../core/services/session.service';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { ManualApi } from '../services/manual-api';
import { PanelDeAyuda } from './panel-de-ayuda';

const CAJA = {
  id: 'caja-diaria',
  titulo: 'Caja diaria',
  grupo: 'Economía',
  markdown:
    '## Para qué sirve\n\nEl cajón de la sede.\n\n![La caja](captura:caja-diaria/abrir-caja)',
  relacionadas: [{ id: 'egresos', titulo: 'Egresos' }],
};
const EGRESOS = {
  id: 'egresos',
  titulo: 'Egresos',
  grupo: 'Economía',
  markdown: 'Gastos.',
  relacionadas: [],
};

describe('PanelDeAyuda', () => {
  const contexto = signal<object | null>({ organizationId: 1, consultorioId: 1 });
  const estado = signal<'activa' | 'anonimo'>('activa');
  let puedePreguntar = false;
  const api = {
    indice: vi.fn(),
    deLaRuta: vi.fn(),
    ficha: vi.fn(),
    buscar: vi.fn(),
  };

  function crear() {
    TestBed.configureTestingModule({
      imports: [PanelDeAyuda],
      providers: [
        provideRouter([]),
        { provide: ManualApi, useValue: api },
        { provide: TenantContextStore, useValue: { context: contexto } },
        { provide: SessionService, useValue: { estado } },
        { provide: PermissionsStore, useValue: { tiene: () => puedePreguntar } },
        { provide: FuncionesIaStore, useValue: { activa: () => puedePreguntar } },
      ],
    });
    const fixture = TestBed.createComponent(PanelDeAyuda);
    const manual = TestBed.inject(ManualStore);
    manual.abrir();
    fixture.detectChanges();
    // Acceso a lo protegido: es el estado que tiene que olvidarse.
    const panel = fixture.componentInstance as unknown as {
      indice: () => unknown;
      verIndice: () => void;
    };
    const el = fixture.nativeElement as HTMLElement;
    const boton = (texto: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes(texto),
      );
    return { fixture, manual, panel, el, boton };
  }

  beforeEach(() => {
    contexto.set({ organizationId: 1, consultorioId: 1 });
    estado.set('activa');
    puedePreguntar = false;
    api.indice
      .mockReset()
      .mockReturnValue(
        of({
          grupos: [
            { nombre: 'Economía', fichas: [{ id: 'egresos', titulo: 'Egresos', tareas: [] }] },
          ],
        }),
      );
    api.deLaRuta.mockReset().mockReturnValue(of(CAJA));
    api.ficha.mockReset().mockReturnValue(of(EGRESOS));
    api.buscar.mockReset().mockReturnValue(of([]));
  });

  afterEach(() => vi.useRealTimers());

  it('muestra la ficha de la pantalla y abre una relacionada con vuelta a la pantalla', () => {
    const { fixture, el, boton } = crear();

    expect(el.querySelector('#ayuda-ficha')?.textContent).toContain('Caja diaria');
    expect(el.querySelector('app-markdown-seguro')).not.toBeNull();

    boton('Egresos')!.click();
    fixture.detectChanges();
    expect(api.ficha).toHaveBeenCalledWith('egresos');
    expect(el.querySelector('#ayuda-ficha')?.textContent).toContain('Egresos');

    boton('Ayuda de esta pantalla')!.click();
    fixture.detectChanges();
    expect(el.querySelector('#ayuda-ficha')?.textContent).toContain('Caja diaria');
  });

  it('avisa cuando la pantalla no tiene ficha y cuando no se pudo traer', () => {
    api.deLaRuta.mockReturnValue(of(null));
    const sinFicha = crear();
    expect(sinFicha.el.textContent).toContain('Esta pantalla todavía no tiene ficha');
    TestBed.resetTestingModule();

    api.deLaRuta.mockReturnValue(throwError(() => new Error('red')));
    const conError = crear();
    expect(conError.el.querySelector('[role="alert"]')?.textContent).toContain(
      'No pudimos traer la ayuda',
    );
  });

  it('busca después de una pausa, muestra los resultados y abre la ficha elegida', () => {
    vi.useFakeTimers();
    api.buscar.mockReturnValue(
      of([
        {
          fichaId: 'egresos',
          fichaTitulo: 'Egresos',
          pasajeId: 'egresos#cargar',
          titulo: 'Cargar',
          fragmento: 'Tocá…',
          enlace: '/egresos',
        },
      ]),
    );
    const { fixture, el } = crear();
    const input = el.querySelector<HTMLInputElement>('#ayuda-buscar')!;

    input.value = 'egreso';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    expect(api.buscar).toHaveBeenCalledWith('egreso', '/');
    const resultado = el.querySelector<HTMLButtonElement>('.ayuda__resultado')!;
    expect(resultado.textContent).toContain('Egresos → Cargar');
    resultado.click();
    fixture.detectChanges();
    expect(api.ficha).toHaveBeenCalledWith('egresos');
  });

  it('dice cuando la búsqueda no encontró nada', () => {
    vi.useFakeTimers();
    const { fixture, el } = crear();
    const input = el.querySelector<HTMLInputElement>('#ayuda-buscar')!;

    input.value = 'nada';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(300);
    fixture.detectChanges();

    expect(el.textContent).toContain('No encontramos nada con esas palabras');
  });

  it('lista el manual por grupo y muestra el error si no se pudo traer', () => {
    const { fixture, el, boton } = crear();
    boton('Ver todo el manual')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.ayuda__grupo')?.textContent).toContain('Economía');
    TestBed.resetTestingModule();

    api.indice.mockReturnValue(throwError(() => new Error('red')));
    const conError = crear();
    conError.boton('Ver todo el manual')!.click();
    conError.fixture.detectChanges();
    expect(conError.el.textContent).toContain('No pudimos traer el manual');
  });

  it('sin sede elegida explica cómo abrir la ayuda y no llama a la API', () => {
    contexto.set(null);
    const { el } = crear();

    expect(el.textContent).toContain('Elegí la sede');
    expect(api.deLaRuta).not.toHaveBeenCalled();
  });

  it('pasa la pregunta al asistente sólo si la persona puede usarlo', () => {
    const sinPermiso = crear();
    expect(sinPermiso.boton('Preguntale al asistente')).toBeUndefined();
    TestBed.resetTestingModule();

    puedePreguntar = true;
    const { boton } = crear();
    boton('Preguntale al asistente')!.click();
    expect(TestBed.inject(PreguntaAlAsistenteStore).pendiente()?.texto).toBe(
      '¿Cómo uso Caja diaria?',
    );
  });

  it('se cierra con Escape salvo que otro diálogo ya lo haya atendido', () => {
    const { fixture, manual } = crear();

    const atendido = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    atendido.preventDefault();
    document.dispatchEvent(atendido);
    fixture.detectChanges();
    expect(manual.abierto()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(manual.abierto()).toBe(false);
  });

  it('amplía una captura y la cierra', () => {
    const { fixture, el, boton } = crear();

    el.querySelector<HTMLButtonElement>('.manual__captura')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.ayuda__lupa img')?.getAttribute('src')).toBe(
      '/manual/caja-diaria/abrir-caja.png',
    );

    boton('Cerrar la imagen')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.ayuda__lupa img')).toBeNull();
  });

  it('olvida el índice al cambiar de sede y lo vuelve a pedir', () => {
    const { fixture, panel } = crear();
    panel.verIndice();
    expect(panel.indice()).not.toBeNull();

    contexto.set({ organizationId: 1, consultorioId: 2 });
    fixture.detectChanges();

    expect(panel.indice()).toBeNull();
    panel.verIndice();
    expect(api.indice).toHaveBeenCalledTimes(2);
  });

  it('se cierra al cerrar la sesión', () => {
    const { fixture, manual } = crear();

    estado.set('anonimo');
    fixture.detectChanges();

    expect(manual.abierto()).toBe(false);
  });
});
