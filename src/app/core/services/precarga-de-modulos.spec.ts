import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouteConfigLoadStart, Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';

import { ID_MANIFIESTO_DE_PRECARGA, PrecargaDeModulos } from './precarga-de-modulos';

/**
 * Precarga de las dependencias de cada pantalla (AKINE-LCP). Lo que importa: que con el
 * manifiesto del build cada dependencia salga UNA vez junto con su pantalla, y que sin manifiesto
 * —desarrollo, tests, un build roto— no haga nada ni rompa la navegacion.
 */
describe('PrecargaDeModulos', () => {
  let documento: Document;

  // La forma compilada de un loadComponent de produccion: el nombre del chunk es lo unico que
  // la precarga lee.
  const fichaCompilada = (): unknown => 'import(`./chunk-Ficha001.js`).then(t=>t.FichaPage)';
  fichaCompilada.toString = () => '()=>import(`./chunk-Ficha001.js`).then(t=>t.FichaPage)';
  const padronCompilado = (): unknown => null;
  padronCompilado.toString = () => "()=>import('./chunk-Padron01.js').then(t=>t.PadronPage)";

  function conManifiesto(contenido: string | null): PrecargaDeModulos {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    documento = TestBed.inject(DOCUMENT);
    documento.getElementById(ID_MANIFIESTO_DE_PRECARGA)?.remove();
    if (contenido !== null) {
      const bloque = documento.createElement('script');
      bloque.type = 'application/json';
      bloque.id = ID_MANIFIESTO_DE_PRECARGA;
      bloque.textContent = contenido;
      documento.body.appendChild(bloque);
    }
    return TestBed.inject(PrecargaDeModulos);
  }

  function precargados(): string[] {
    return [...documento.head.querySelectorAll('link[rel="modulepreload"]')].map(
      (enlace) => enlace.getAttribute('href') ?? '',
    );
  }

  afterEach(() => {
    documento.getElementById(ID_MANIFIESTO_DE_PRECARGA)?.remove();
    documento.head.querySelectorAll('link[rel="modulepreload"]').forEach((e) => e.remove());
  });

  it('agrega un modulepreload por dependencia, una sola vez aunque dos pantallas la compartan', () => {
    const precarga = conManifiesto(
      JSON.stringify({
        'chunk-Ficha001.js': ['chunk-Forms001.js', 'chunk-Api00001.js'],
        'chunk-Padron01.js': ['chunk-Api00001.js', 'chunk-Tabla001.js'],
      }),
    );

    precarga.precargar(fichaCompilada);
    precarga.precargar(fichaCompilada);
    precarga.precargar(padronCompilado);

    expect(precargados()).toEqual(['chunk-Forms001.js', 'chunk-Api00001.js', 'chunk-Tabla001.js']);
  });

  it('se engancha a cada pantalla que el router empieza a bajar, después de pedir su chunk', async () => {
    const eventos = new Subject<unknown>();
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { events: eventos } }],
    });
    documento = TestBed.inject(DOCUMENT);
    const bloque = documento.createElement('script');
    bloque.type = 'application/json';
    bloque.id = ID_MANIFIESTO_DE_PRECARGA;
    bloque.textContent = JSON.stringify({ 'chunk-Ficha001.js': ['chunk-Forms001.js'] });
    documento.body.appendChild(bloque);
    const precarga = TestBed.inject(PrecargaDeModulos);

    TestBed.runInInjectionContext(() => precarga.escucharRouter());
    eventos.next(new RouteConfigLoadStart({ path: 'otra' }));
    await Promise.resolve();
    expect(precargados()).toEqual([]);

    eventos.next(new RouteConfigLoadStart({ path: ':id', loadComponent: fichaCompilada as never }));
    // Un microtask despues: el router llama al loadComponent justo despues de emitir el evento,
    // y el chunk de la pantalla tiene que pedir conexion antes que sus dependencias.
    expect(precargados()).toEqual([]);
    await Promise.resolve();
    expect(precargados()).toEqual(['chunk-Forms001.js']);
  });

  it('sin manifiesto, con uno roto o con un loadComponent sin chunk no hace nada', () => {
    conManifiesto(null).precargar(fichaCompilada);
    expect(precargados()).toEqual([]);

    TestBed.resetTestingModule();
    conManifiesto('{ no es json').precargar(fichaCompilada);
    expect(precargados()).toEqual([]);

    TestBed.resetTestingModule();
    const precarga = conManifiesto(JSON.stringify({ 'chunk-Ficha001.js': ['chunk-Forms001.js'] }));
    precarga.precargar(() => import('./precarga-de-modulos'));
    precarga.precargar(undefined);
    precarga.precargar(padronCompilado);
    expect(precargados()).toEqual([]);
  });
});
