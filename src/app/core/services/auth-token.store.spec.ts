import { TestBed } from '@angular/core/testing';

import { AuthTokenStore } from './auth-token.store';

/**
 * Verifica la custodia del access token (ADR-0001).
 *
 * <p>El test que importa no es el de set/clear: es el que confirma que el token
 * <b>no toca ningun almacen persistente</b>. Esa es la decision de seguridad, y sin un
 * test que la fije, un refactor bienintencionado -"para que sobreviva al F5"- la revierte
 * sin que nadie lo note.
 */
describe('AuthTokenStore', () => {
  let store: AuthTokenStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(AuthTokenStore);
  });

  it('arranca sin sesion', () => {
    expect(store.token()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
  });

  it('guarda el token y marca la sesion como activa', () => {
    store.set('un-jwt');

    expect(store.token()).toBe('un-jwt');
    expect(store.isAuthenticated()).toBe(true);
  });

  it('limpiar deja la sesion inactiva', () => {
    store.set('un-jwt');
    store.clear();

    expect(store.token()).toBeNull();
    expect(store.isAuthenticated()).toBe(false);
  });

  it('reemplaza el token al renovarse, sin acumular', () => {
    store.set('token-viejo');
    store.set('token-nuevo');

    expect(store.token()).toBe('token-nuevo');
  });

  it('NO escribe el token en localStorage ni en sessionStorage', () => {
    const escrituraLocal = vi.spyOn(Storage.prototype, 'setItem');

    store.set('jwt-secreto');

    // ADR-0001: AKINE maneja historia clinica. Un XSS lee todo el storage del navegador,
    // asi que el access token no puede estar ahi bajo ninguna circunstancia.
    expect(escrituraLocal).not.toHaveBeenCalled();

    // Excepcion justificada a no-restricted-globals: este test es precisamente el que
    // verifica que el token NO esta en el storage. Para probarlo hay que leerlo.
    // Es el unico lugar del proyecto donde se permite tocarlo.
    /* eslint-disable no-restricted-globals */
    expect(localStorage.getItem('token')).toBeNull();
    expect(sessionStorage.getItem('token')).toBeNull();
    /* eslint-enable no-restricted-globals */

    escrituraLocal.mockRestore();
  });

  it('el token no sobrevive a una instancia nueva del store', () => {
    store.set('jwt-secreto');

    // Simula el arranque en una pestana nueva: sin persistencia, no hay token.
    // Recuperarlo es responsabilidad del refresh token en cookie httpOnly (F1/M02).
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const storeNuevo = TestBed.inject(AuthTokenStore);

    expect(storeNuevo.token()).toBeNull();
  });
});
