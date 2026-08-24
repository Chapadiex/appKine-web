import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable, isObservable } from 'rxjs';

import { permissionGuard } from './permission.guard';
import { PermissionsStore } from '../services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../testing/rutas-api';
import { SessionService } from '../services/session.service';
import { PERMISO_COLABORADOR_MANAGE, PERMISO_COLABORADOR_READ } from '../models/permisos';
import { provideApi } from '../../api/generated/provide-api';

/**
 * Verifica el guard de permisos (AKINE-01.03).
 *
 * <p>Igual que los otros guards, se prueba <b>a donde empuja</b>, no que proteja: es UX. El
 * backend rechaza igual a quien llegue por URL directa, y ninguna asercion de este archivo
 * es una garantia de seguridad.
 */
describe('permissionGuard', () => {
  let session: SessionService;
  let store: PermissionsStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(''),
        provideRouter([]),
      ],
    });

    session = TestBed.inject(SessionService);
    store = TestBed.inject(PermissionsStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sin sesion manda al login recordando el destino', () => {
    const url = urlDe(correr(permissionGuard(PERMISO_COLABORADOR_READ), '/organizacion/1/equipo'));

    expect(url).toContain('/auth/ingresar');
    expect(url).toContain('volverA=%2Forganizacion%2F1%2Fequipo');
  });

  it('autenticado pero sin contexto manda al selector, no a "no tenes permiso"', () => {
    autenticar('pre_context');

    // Los permisos son DE un contexto: sin contexto la pregunta no tiene respuesta, y
    // decirle "no tenes permiso" a quien solo no eligio consultorio lo deja sin salida.
    const url = urlDe(correr(permissionGuard(PERMISO_COLABORADOR_READ), '/organizacion/1/equipo'));

    expect(url).toContain('/seleccionar-contexto');
  });

  it('con el permiso, deja pasar sin volver a pedir la lista', () => {
    autenticar('context');
    cargarPermisos([PERMISO_COLABORADOR_READ]);

    expect(correr(permissionGuard(PERMISO_COLABORADOR_READ), '/organizacion/1/equipo')).toBe(true);
    // Sin peticion pendiente: ya estaban cargados para este contexto.
  });

  it('sin el permiso manda a la pantalla de permiso insuficiente, nunca al login', () => {
    autenticar('context');
    cargarPermisos([PERMISO_COLABORADOR_READ]);

    const url = urlDe(
      correr(permissionGuard(PERMISO_COLABORADOR_MANAGE), '/organizacion/1/equipo'),
    );

    // Reautenticarse no otorga un permiso que vive en la membership: mandarlo al login
    // seria un bucle. Y ni siquiera se guarda el destino: volver ahi sigue sin funcionar.
    expect(url).toContain('/sin-permiso');
    expect(url).not.toContain('/auth/ingresar');
  });

  it('alcanza con tener alguno de los permisos pedidos', () => {
    autenticar('context');
    cargarPermisos([PERMISO_COLABORADOR_READ]);

    const guard = permissionGuard(PERMISO_COLABORADOR_MANAGE, PERMISO_COLABORADOR_READ);

    expect(correr(guard, '/organizacion/1/equipo')).toBe(true);
  });

  it('si los permisos no estan cargados, los pide y espera la respuesta', async () => {
    autenticar('context');

    const resultado = correr(permissionGuard(PERMISO_COLABORADOR_READ), '/organizacion/1/equipo');
    expect(isObservable(resultado)).toBe(true);

    const decidido = resuelto(resultado as Observable<boolean | UrlTree>);
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_COLABORADOR_READ] });

    // Decidir sin esperar negaria el paso a quien si tiene el permiso: es la falla mas
    // cara de las dos, porque deja al usuario sin acceso a algo que le corresponde.
    expect(await decidido).toBe(true);
  });

  it('si la carga de permisos falla, deniega en vez de dejar pasar', async () => {
    autenticar('context');

    const decidido = resuelto(
      correr(permissionGuard(PERMISO_COLABORADOR_READ), '/organizacion/1/equipo') as Observable<
        boolean | UrlTree
      >,
    );
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({}, { status: 503, statusText: 'Service Unavailable' });

    // No se puede afirmar que alguien tiene un permiso que no se pudo consultar.
    expect(urlDe(await decidido)).toContain('/sin-permiso');
  });

  it('sin permisos declarados, deniega', () => {
    autenticar('context');
    cargarPermisos([PERMISO_COLABORADOR_READ]);

    expect(urlDe(correr(permissionGuard(), '/organizacion/1/equipo'))).toContain('/sin-permiso');
  });

  it('despues de cambiar de contexto vuelve a pedir los permisos', async () => {
    autenticar('context');
    cargarPermisos([PERMISO_COLABORADOR_MANAGE]);

    // Cambio de contexto: mismo usuario, otra organizacion.
    session.seleccionarContexto(2, 20).subscribe();
    httpMock.expectOne('/api/v1/auth/context').flush({
      accessToken: 'jwt-ctx-2',
      scope: 'context',
      organizationId: 2,
      consultorioId: 20,
    });

    const decidido = resuelto(
      correr(permissionGuard(PERMISO_COLABORADOR_MANAGE), '/organizacion/2/equipo') as Observable<
        boolean | UrlTree
      >,
    );
    // Los permisos de la Org 1 ya no valen: el guard no decide con ellos, pide de nuevo.
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    expect(urlDe(await decidido)).toContain('/sin-permiso');
  });

  // --- Ayudas ----------------------------------------------------------------------

  /** Autentica contra el flujo real para no falsear el estado del servicio. */
  function autenticar(scope: 'pre_context' | 'context'): void {
    session.login('kine@akine.test', 'clave-sintetica').subscribe();
    httpMock.expectOne('/api/v1/auth/login').flush({ accessToken: 'jwt', scope: 'pre_context' });

    if (scope === 'context') {
      session.seleccionarContexto(1, 10).subscribe();
      httpMock.expectOne('/api/v1/auth/context').flush({
        accessToken: 'jwt-ctx',
        scope: 'context',
        organizationId: 1,
        consultorioId: 10,
      });
    }
  }

  function cargarPermisos(permissions: string[]): void {
    store.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions });
  }

  function correr(
    guard: ReturnType<typeof permissionGuard>,
    url: string,
  ): boolean | UrlTree | Observable<boolean | UrlTree> {
    return TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    ) as boolean | UrlTree | Observable<boolean | UrlTree>;
  }

  function resuelto(flujo: Observable<boolean | UrlTree>): Promise<boolean | UrlTree> {
    return new Promise((resolve) => flujo.subscribe(resolve));
  }

  function urlDe(resultado: boolean | UrlTree | Observable<boolean | UrlTree>): string {
    expect(resultado).toBeInstanceOf(UrlTree);
    return (resultado as UrlTree).toString();
  }
});
