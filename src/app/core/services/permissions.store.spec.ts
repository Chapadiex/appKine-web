import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { PermissionsStore } from './permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../testing/rutas-api';
import { TenantContextStore } from './tenant-context.store';
import { provideApi } from '../../api/generated/provide-api';
import { PERMISO_COLABORADOR_MANAGE, PERMISO_COLABORADOR_READ } from '../models/permisos';

const ORG_A = { organizationId: 1, organizationName: 'Centro Kine A', consultorioId: 10 };
const ORG_B = { organizationId: 2, organizationName: 'Centro Kine B', consultorioId: 20 };

/**
 * Verifica los permisos efectivos del contexto activo (AKINE-01.03).
 *
 * <p>Nada de lo que se prueba aca es una garantia de seguridad: el backend rechaza igual.
 * Lo que se prueba es <b>aislamiento entre contextos</b>, que si es un bug real y grave:
 * permisos de la Organizacion A vigentes bajo la B dibujan acciones sobre datos ajenos.
 */
describe('PermissionsStore', () => {
  let store: PermissionsStore;
  let tenant: TenantContextStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideApi('')],
    });

    store = TestBed.inject(PermissionsStore);
    tenant = TestBed.inject(TenantContextStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('arranca sin permisos y sin haberlos cargado', () => {
    expect(store.cargados()).toBe(false);
    expect(store.permisos().size).toBe(0);
    expect(store.tiene(PERMISO_COLABORADOR_READ)).toBe(false);
  });

  it('carga los permisos efectivos del contexto activo', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_READ, PERMISO_COLABORADOR_MANAGE]);

    expect(store.cargados()).toBe(true);
    expect(store.tiene(PERMISO_COLABORADOR_READ)).toBe(true);
    expect(store.tiene('caja:operate')).toBe(false);
    expect(store.tieneAlguno('caja:operate', PERMISO_COLABORADOR_MANAGE)).toBe(true);
    expect(store.tieneAlguno('caja:operate')).toBe(false);
  });

  it('distingue "no tiene ninguno" de "todavia no cargaron"', () => {
    tenant.select(ORG_A);
    cargar([]);

    // Es la distincion que le permite a la directiva no tratar el arranque como una
    // denegacion definitiva: mismo Set vacio, significado opuesto.
    expect(store.cargados()).toBe(true);
    expect(store.permisos().size).toBe(0);
  });

  it('sin argumentos, tieneAlguno deniega', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_READ]);

    // Un spread de un array vacio por error no puede abrir todas las pantallas.
    expect(store.tieneAlguno()).toBe(false);
  });

  it('una respuesta sin el campo permissions no rompe: se trata como conjunto vacio', () => {
    tenant.select(ORG_A);
    store.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({});

    expect(store.cargados()).toBe(true);
    expect(store.permisos().size).toBe(0);
  });

  it('propaga el error en vez de fingir que no hay permisos', () => {
    tenant.select(ORG_A);

    let fallo: unknown = null;
    store.cargar().subscribe({ error: (error: unknown) => (fallo = error) });
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({}, { status: 503, statusText: 'Service Unavailable' });

    // Tragarse el error dibujaria "no tenes permisos" ante una caida de red.
    expect(fallo).not.toBeNull();
    expect(store.cargados()).toBe(false);
  });

  it('cambiar de contexto invalida los permisos en el mismo tick, sin un render de por medio', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_MANAGE]);
    expect(store.tiene(PERMISO_COLABORADOR_MANAGE)).toBe(true);

    tenant.select(ORG_B);

    // Sincronico: no hay `effect`, ni microtarea, ni deteccion de cambios de por medio.
    // Los permisos de la Org A no sobreviven ni un render bajo la Org B.
    expect(store.cargados()).toBe(false);
    expect(store.permisos().size).toBe(0);
    expect(store.tiene(PERMISO_COLABORADOR_MANAGE)).toBe(false);
  });

  it('el logout (clear del contexto) tambien los invalida', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_READ]);

    tenant.clear();

    expect(store.cargados()).toBe(false);
    expect(store.tiene(PERMISO_COLABORADOR_READ)).toBe(false);
  });

  it('una respuesta que llega despues del cambio de contexto se descarta', () => {
    tenant.select(ORG_A);
    store.cargar().subscribe();
    const enVuelo = httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS);

    // El usuario cambia de organizacion mientras la peticion viaja.
    tenant.select(ORG_B);
    enVuelo.flush({ permissions: [PERMISO_COLABORADOR_MANAGE] });

    // Esos permisos son de la Org A. Guardarlos seria el bug de aislamiento exacto.
    expect(store.cargados()).toBe(false);
    expect(store.tiene(PERMISO_COLABORADOR_MANAGE)).toBe(false);
  });

  it('recargar bajo el contexto nuevo repuebla los permisos', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_MANAGE]);

    tenant.select(ORG_B);
    cargar([PERMISO_COLABORADOR_READ]);

    expect(store.tiene(PERMISO_COLABORADOR_READ)).toBe(true);
    expect(store.tiene(PERMISO_COLABORADOR_MANAGE)).toBe(false);
  });

  it('limpiar descarta lo cargado', () => {
    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_READ]);

    store.limpiar();

    expect(store.cargados()).toBe(false);
    expect(store.permisos().size).toBe(0);
  });

  it('no escribe los permisos en ningun storage del navegador', () => {
    // Se espia el prototipo y no los globales prohibidos por ESLint (ADR-0001): la regla
    // impide escribir 'localStorage' en el codigo, y este test tiene que poder afirmar lo
    // mismo sin nombrarlos. Un permiso persistido es doblemente malo: lo lee un XSS y
    // sobrevive a la revocacion del rol que lo otorgaba.
    const escribir = vi.spyOn(Storage.prototype, 'setItem');

    tenant.select(ORG_A);
    cargar([PERMISO_COLABORADOR_MANAGE]);
    tenant.select(ORG_B);
    store.limpiar();

    expect(escribir).not.toHaveBeenCalled();
    escribir.mockRestore();
  });

  it('asegurarCargados no sale a la red sin contexto', () => {
    // Sin contexto el backend responde 403 missing-tenant-context, y sin sesion 403 a secas.
    // La directiva llama a esto en toda pantalla que muestre acciones: si no cortara aca,
    // cada pantalla publica dejaria un error rojo en consola que no significa nada.
    store.asegurarCargados();

    httpMock.expectNone(RUTA_PERMISOS_EFECTIVOS);
    expect(store.cargados()).toBe(false);
  });

  it('asegurarCargados es una sola peticion, la llamen una vez o veinte', () => {
    tenant.select(ORG_A);

    // Una tabla de veinte filas instancia veinte directivas que llaman en el mismo tick,
    // antes de que ninguna respuesta llegue: sin la bandera de carga en vuelo serian veinte
    // GET identicos.
    store.asegurarCargados();
    store.asegurarCargados();
    store.asegurarCargados();

    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_COLABORADOR_READ] });
    expect(store.tiene(PERMISO_COLABORADOR_READ)).toBe(true);

    // Y ya cargados, tampoco: el cache corta antes que la bandera.
    store.asegurarCargados();
    httpMock.expectNone(RUTA_PERMISOS_EFECTIVOS);
  });

  it('si la carga de asegurarCargados falla, no rompe y deja reintentar', () => {
    tenant.select(ORG_A);

    store.asegurarCargados();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({}, { status: 503, statusText: 'Service Unavailable' });

    // Degradacion correcta: la pantalla muestra la tabla sin acciones, y el backend habria
    // rechazado igual. Pero la bandera se libera, asi que el proximo intento sale.
    expect(store.cargados()).toBe(false);

    store.asegurarCargados();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_COLABORADOR_READ] });
    expect(store.tiene(PERMISO_COLABORADOR_READ)).toBe(true);
  });

  // --- Ayudas ----------------------------------------------------------------------

  function cargar(permissions: string[]): void {
    store.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions });
  }
});
