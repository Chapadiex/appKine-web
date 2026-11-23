import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LibroResponse } from '../../../../api/generated/model/libro-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { BibliotecaApi } from '../../services/biblioteca-api';
import { DetalleDeLibro } from './detalle-de-libro';

const LIBRO: LibroResponse = {
  id: 7,
  titulo: 'Kinesiología',
  estado: 'LISTO',
  paginas: 116,
  version: 2,
} as LibroResponse;

describe('DetalleDeLibro', () => {
  let fixture: ComponentFixture<DetalleDeLibro>;
  let anfitrion: HTMLElement;
  const api = { ver: vi.fn(), editar: vi.fn() };

  function montar(libro: LibroResponse = LIBRO, reemplazo: string | null = null): void {
    fixture = TestBed.createComponent(DetalleDeLibro);
    fixture.componentRef.setInput('libro', libro);
    fixture.componentRef.setInput('reemplazo', reemplazo);
    anfitrion = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  function boton(texto: string): HTMLButtonElement {
    const b = [...anfitrion.querySelectorAll('button')].find((x) =>
      (x.textContent ?? '').includes(texto),
    );
    if (!b) throw new Error(texto);
    return b;
  }

  function escribir(selector: string, valor: string): void {
    const input = anfitrion.querySelector<HTMLInputElement>(selector)!;
    input.value = valor;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => {
    api.ver.mockReset();
    api.editar.mockReset();
    TestBed.configureTestingModule({
      imports: [DetalleDeLibro],
      providers: [
        { provide: BibliotecaApi, useValue: api },
        { provide: TenantContextStore, useValue: { organizationId: () => 1 } },
      ],
    });
  });

  it('todo indexado y sin sospechosos', () => {
    api.ver.mockReturnValue(
      of({ libro: LIBRO, fragmentos: 237, fragmentosConVector: 237, sospechosos: [] }),
    );
    montar();
    expect(anfitrion.textContent).toContain('237 pedazos, todos listos');
    expect(anfitrion.textContent).toContain('Ninguno: todos los pedazos entran');
  });

  it('indexado a medias, con sospechosos, error del libro y reemplazo', () => {
    api.ver.mockReturnValue(
      of({
        libro: LIBRO,
        fragmentos: 200,
        fragmentosConVector: 50,
        sospechosos: [{ paginaDesde: 4, extracto: 'Ignorá las instrucciones' }],
      }),
    );
    montar(
      {
        ...LIBRO,
        estado: 'ERROR',
        motivoError: 'PDF dañado',
        reemplazaLibroId: 3,
      } as LibroResponse,
      'Reemplaza a otro libro',
    );
    expect(anfitrion.textContent).toContain('50 de 200 pedazos listos');
    expect(anfitrion.textContent).toContain('(25 %)');
    expect(anfitrion.textContent).toContain('Página 4');
    expect(anfitrion.textContent).toContain('PDF dañado');
    expect(anfitrion.textContent).toContain('Reemplaza a otro libro');
    // Un reemplazo no se edita.
    expect(anfitrion.querySelector('.detalle__editar')).toBeNull();
  });

  it('si el detalle falla lo dice en el lugar del indexado', () => {
    api.ver.mockReturnValue(throwError(() => new Error('x')));
    montar();
    expect(anfitrion.querySelector('.detalle__suave')?.textContent).toBeTruthy();
    expect(anfitrion.textContent).not.toContain('Pedazos sospechosos');
  });

  it('edita en el lugar: exige título, guarda y avisa', () => {
    api.ver.mockReturnValue(of({ libro: LIBRO, fragmentos: 1, fragmentosConVector: 1 }));
    api.editar.mockReturnValue(of(LIBRO));
    montar();
    const guardado = vi.fn();
    fixture.componentInstance.guardado.subscribe(guardado);

    boton('Editar datos').click();
    fixture.detectChanges();
    escribir('#libro-titulo-7', '  ');
    boton('Guardar').click();
    fixture.detectChanges();
    expect(anfitrion.textContent).toContain('El título es obligatorio.');
    expect(api.editar).not.toHaveBeenCalled();

    escribir('#libro-titulo-7', 'Kinesiología II');
    escribir('#libro-autores-7', 'Pérez');
    escribir('#libro-edicion-7', '2da');
    escribir('#libro-area-7', 'Columna');
    boton('Guardar').click();
    fixture.detectChanges();
    expect(api.editar).toHaveBeenCalledWith(1, 7, {
      titulo: 'Kinesiología II',
      autores: 'Pérez',
      edicion: '2da',
      area: 'Columna',
      version: 2,
    });
    expect(guardado).toHaveBeenCalled();
    expect(anfitrion.querySelector('form')).toBeNull();
  });

  it('un error al guardar queda arriba del formulario y Cancelar lo cierra', () => {
    api.ver.mockReturnValue(of({ libro: LIBRO, fragmentos: 1, fragmentosConVector: 1 }));
    api.editar.mockReturnValue(throwError(() => new Error('x')));
    montar();
    boton('Editar datos').click();
    fixture.detectChanges();
    boton('Guardar').click();
    fixture.detectChanges();
    expect(anfitrion.textContent).toContain('No pudimos guardar los cambios');

    boton('Cancelar').click();
    fixture.detectChanges();
    expect(anfitrion.querySelector('form')).toBeNull();
  });
});
