import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable } from 'rxjs';

import { funcionIaGuard } from './funcion-ia.guard';
import { FuncionIa, FuncionesIaStore } from '../services/funciones-ia.store';

/**
 * El guard de funciones de IA es UX: el backend responde 409/404 con la funcion apagada. Se prueba
 * a donde empuja y que no decide mientras el store no sabe.
 */
describe('funcionIaGuard', () => {
  const sabe = signal(false);
  const activas = signal<ReadonlySet<FuncionIa>>(new Set());

  beforeEach(() => {
    sabe.set(false);
    activas.set(new Set());
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: FuncionesIaStore,
          useValue: { sabe, activa: (f: FuncionIa) => activas().has(f) },
        },
      ],
    });
  });

  function correr(): unknown[] {
    const salida: unknown[] = [];
    TestBed.runInInjectionContext(() =>
      (
        funcionIaGuard('ASISTENTE')(
          {} as ActivatedRouteSnapshot,
          { url: '/asistente' } as RouterStateSnapshot,
        ) as Observable<boolean | UrlTree>
      ).subscribe((valor) => salida.push(valor)),
    );
    TestBed.tick();
    return salida;
  }

  it('deja pasar si la funcion esta activa', () => {
    sabe.set(true);
    activas.set(new Set<FuncionIa>(['ASISTENTE']));

    expect(correr()).toEqual([true]);
  });

  it('con la funcion apagada vuelve al inicio', () => {
    sabe.set(true);
    activas.set(new Set<FuncionIa>(['BIBLIOTECA']));

    const [valor] = correr();
    expect(valor).toBeInstanceOf(UrlTree);
    expect((valor as UrlTree).toString()).toBe('/');
  });

  it('espera mientras el store no sabe, y decide cuando sabe', () => {
    const salida = correr();
    expect(salida).toEqual([]);

    activas.set(new Set<FuncionIa>(['ASISTENTE']));
    sabe.set(true);
    TestBed.tick();

    expect(salida).toEqual([true]);
  });
});
