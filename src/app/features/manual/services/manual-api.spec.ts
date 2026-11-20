import { HttpResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ManualService } from '../../../api/generated/api/manual.service';
import { ManualApi } from './manual-api';

describe('ManualApi', () => {
  const servicio = {
    verIndiceDelManual: vi.fn(() => of({ grupos: [] })),
    verFichaDelManual: vi.fn(() => of({ id: 'caja-diaria' })),
    verFichaDeLaRuta: vi.fn(),
    buscarEnElManual: vi.fn(() => of([])),
  };

  function crear(): ManualApi {
    TestBed.configureTestingModule({ providers: [{ provide: ManualService, useValue: servicio }] });
    return TestBed.inject(ManualApi);
  }

  it('devuelve null cuando la pantalla no tiene ficha (204)', () => {
    servicio.verFichaDeLaRuta.mockReturnValue(of(new HttpResponse({ status: 204, body: null })));
    let ficha: unknown = 'sin respuesta';

    crear()
      .deLaRuta('/no-existe')
      .subscribe((f) => (ficha = f));

    expect(servicio.verFichaDeLaRuta).toHaveBeenCalledWith({ ruta: '/no-existe' }, 'response');
    expect(ficha).toBeNull();
  });

  it('devuelve la ficha de la pantalla y pasa la ruta y la consulta tal cual', () => {
    servicio.verFichaDeLaRuta.mockReturnValue(
      of(new HttpResponse({ status: 200, body: { id: 'caja-diaria' } })),
    );
    const api = crear();
    let ficha: unknown;

    api.deLaRuta('/caja').subscribe((f) => (ficha = f));
    api.buscar('arqueo', '/caja').subscribe();
    api.ficha('caja-diaria').subscribe();
    api.indice().subscribe();

    expect(ficha).toEqual({ id: 'caja-diaria' });
    expect(servicio.buscarEnElManual).toHaveBeenCalledWith({ q: 'arqueo', ruta: '/caja' });
    expect(servicio.verFichaDelManual).toHaveBeenCalledWith({ id: 'caja-diaria' });
    expect(servicio.verIndiceDelManual).toHaveBeenCalled();
  });
});
