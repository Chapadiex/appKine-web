import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';

import { DictadoService } from '../../api/generated/api/dictado.service';
import { AkineHttpError } from '../../core/interceptors/error.interceptor';
import { PermissionsStore } from '../../core/services/permissions.store';
import { TenantContextStore } from '../../core/services/tenant-context.store';
import { DictadoStore, agregarAlCampo } from './dictado.store';

describe('agregarAlCampo', () => {
  it('agrega al final con un espacio, avisa con input y respeta el largo máximo', () => {
    const campo = document.createElement('textarea');
    campo.value = 'Dolor';
    campo.maxLength = 12;
    const escuchado = vi.fn();
    campo.addEventListener('input', escuchado);

    agregarAlCampo(campo, 'seis en rodilla');

    expect(campo.value).toBe('Dolor seis e');
    expect(escuchado).toHaveBeenCalledTimes(1);
  });

  it('no duplica el espacio ni agrega uno a un campo vacío', () => {
    const campo = document.createElement('input');
    agregarAlCampo(campo, 'hola');
    expect(campo.value).toBe('hola');
    campo.value = 'hola ';
    agregarAlCampo(campo, 'chau');
    expect(campo.value).toBe('hola chau');
  });
});

describe('DictadoStore', () => {
  const consultorioId = signal<number | null>(1);
  const api = {
    transcribirDictado: vi.fn(),
    proponerEvaluacionDictada: vi.fn(),
  };

  function crear(): DictadoStore {
    TestBed.configureTestingModule({
      providers: [
        { provide: DictadoService, useValue: api },
        { provide: PermissionsStore, useValue: { tiene: () => true } },
        { provide: TenantContextStore, useValue: { consultorioId } },
      ],
    });
    return TestBed.inject(DictadoStore);
  }

  beforeEach(() => {
    consultorioId.set(1);
    api.transcribirDictado.mockReset();
    api.proponerEvaluacionDictada.mockReset();
  });

  it('sin micrófono en el navegador no se ofrece y empezar falla traducido', async () => {
    const store = crear();
    const dueno = {};

    expect(store.disponible()).toBe(false);
    await expect(store.empezar(dueno)).rejects.toMatchObject({ causa: 'otro' });
    expect(store.grabando(dueno)).toBe(false);
  });

  it('transcribir de quien no está grabando no llama al servidor', async () => {
    const store = crear();

    expect(await store.transcribir({})).toBe('');
    expect(api.transcribirDictado).not.toHaveBeenCalled();
  });

  it('proponer sin sede elegida no llama al servidor', async () => {
    consultorioId.set(null);
    const store = crear();

    expect(await store.proponerEvaluacion('dolor 5')).toEqual({});
    expect(api.proponerEvaluacionDictada).not.toHaveBeenCalled();
  });

  it('propone con la sede activa y devuelve la propuesta', async () => {
    api.proponerEvaluacionDictada.mockReturnValue(of({ dolorEva: 5 }));
    const store = crear();

    expect(await store.proponerEvaluacion('dolor 5')).toEqual({ dolorEva: 5 });
    expect(api.proponerEvaluacionDictada).toHaveBeenCalledWith({
      consultorioId: 1,
      proponerEvaluacionDictada: { texto: 'dolor 5' },
    });
  });

  it('un 409 dictado-deshabilitado apaga el dictado hasta recargar', async () => {
    api.proponerEvaluacionDictada.mockReturnValue(
      throwError(
        () =>
          new AkineHttpError(
            409,
            { type: 'https://akine.app/problems/dictado-deshabilitado' },
            false,
          ),
      ),
    );
    const store = crear();

    await expect(store.proponerEvaluacion('x')).rejects.toMatchObject({ causa: 'deshabilitado' });
    expect(store.disponible()).toBe(false);
  });
});
