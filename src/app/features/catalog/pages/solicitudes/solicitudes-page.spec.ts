import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { SolicitudesPage } from './solicitudes-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PENDIENTE = {
  id: 7,
  organizationId: 1,
  tipo: 'ESPECIALIDAD',
  nombrePropuesto: 'Terapia ocupacional',
  justificacion: 'Resolucion 1234 del ministerio',
  estado: 'PENDIENTE',
  createdAt: '2026-08-20T12:00:00Z',
  version: 1,
};

const APROBADA = {
  ...PENDIENTE,
  id: 6,
  nombrePropuesto: 'Fonoaudiologia',
  estado: 'APROBADA',
  conceptoId: 44,
  resolucionNota: 'Ya estaba con otro nombre',
  version: 2,
};

const LISTADO = '/api/v1/catalogo-solicitudes';

/**
 * Spec de los pedidos al catalogo de la plataforma (RF-M06-005, AKINE-02.05).
 *
 * <p>Cubre lo que hace que el pedido no sea un embudo: que la pantalla diga, <b>antes</b> de
 * pedir nada, que un concepto propio se puede dar de alta ya mismo. Sin eso el centro espera
 * una resolucion que no necesita para trabajar.
 *
 * <p>Y cubre que lo que se manda sea una <b>propuesta</b> con justificacion: es lo unico con
 * lo que la plataforma decide.
 */
describe('SolicitudesPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SolicitudesPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => httpMock.verify());

  it('dice que no hace falta esperar, y esta pantalla no resuelve nada', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    expect(anfitrion.textContent).toContain('Si lo necesitas hoy, no hace falta pedirlo');

    // Resolver exige rol de plataforma y el frontend no tiene forma de saber si quien mira lo
    // tiene: aprobar y rechazar no se ofrecen aca. Ver el javadoc de la pantalla.
    expect(anfitrion.textContent).not.toContain('Aprobar');
    expect(anfitrion.textContent).not.toContain('Rechazar');

    // El pendiente dice que hacer mientras tanto; el aprobado, donde encontrar el concepto.
    expect(anfitrion.textContent).toContain('podes darlo de alta como un concepto de tu centro');
    expect(anfitrion.textContent).toContain('Solo los de la plataforma');
  });

  it('el pedido viaja como propuesta, con la justificacion', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    const abrir = [...anfitrion.querySelectorAll('button')].find((boton) =>
      (boton.textContent ?? '').includes('Pedir un concepto'),
    );
    abrir?.click();
    fixture.detectChanges();

    elegir(anfitrion, '#solicitud-tipo', 'PRACTICA');
    escribir(anfitrion, '#solicitud-nombre', 'Drenaje linfatico');
    escribir(anfitrion, '#solicitud-justificacion', 'La pide la obra social provincial');
    fixture.detectChanges();

    anfitrion.querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.method === 'POST' && candidata.url === LISTADO,
    );
    // El codigo propuesto es opcional y se omite cuando esta vacio: mandarlo como cadena
    // vacia haria que la plataforma vea un codigo que nadie propuso.
    expect(peticion.request.body).toEqual({
      tipo: 'PRACTICA',
      nombrePropuesto: 'Drenaje linfatico',
      justificacion: 'La pide la obra social provincial',
    });

    peticion.flush({ ...PENDIENTE, id: 8, tipo: 'PRACTICA' });
    httpMock.expectOne(esListado()).flush([PENDIENTE, APROBADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('Tu pedido quedo registrado');
  });

  it('pedir dos veces lo mismo se explica en el campo, no como un error generico', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    const abrir = [...anfitrion.querySelectorAll('button')].find((boton) =>
      (boton.textContent ?? '').includes('Pedir un concepto'),
    );
    abrir?.click();
    fixture.detectChanges();

    elegir(anfitrion, '#solicitud-tipo', 'ESPECIALIDAD');
    escribir(anfitrion, '#solicitud-nombre', 'Terapia ocupacional');
    escribir(anfitrion, '#solicitud-codigo', 'TO');
    escribir(anfitrion, '#solicitud-justificacion', 'Resolucion 1234');
    fixture.detectChanges();

    anfitrion.querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.method === 'POST' && candidata.url === LISTADO,
    );
    // Con codigo propuesto cargado, ahora si viaja.
    expect(peticion.request.body).toMatchObject({ codigoPropuesto: 'TO' });

    peticion.flush(
      {
        type: 'https://akine.app/problems/catalogo-solicitud-duplicada',
        detail: 'ya existe una pendiente',
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    // El duplicado aterriza en el campo del nombre -es lo que hay que cambiar- y no al pie.
    const campo = anfitrion.querySelector('#solicitud-nombre');
    expect(campo?.getAttribute('aria-invalid')).toBe('true');
    expect(anfitrion.textContent).toContain('pedirlo dos veces no la acelera');
  });

  it('el filtro por estado recarga con su parametro y la lista vacia no es un error', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    elegir(anfitrion, '#filtro-estado-solicitud', 'RECHAZADA');
    fixture.detectChanges();

    const filtrada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === LISTADO && peticion.params.get('estado') === 'RECHAZADA',
    );
    filtrada.flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('todavia no hizo ningun pedido');
  });

  it('sin organizacion elegida no consulta nada y manda a elegir contexto', async () => {
    const fixture = TestBed.createComponent(SolicitudesPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === LISTADO);

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Todavia no elegiste un consultorio');
    // La salida es elegir contexto, NO re-autenticarse: las credenciales estan bien.
    expect(anfitrion.textContent).toContain('Tu sesion sigue abierta');
    expect(anfitrion.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  it('un error de lectura se puede reintentar sin recargar la pagina', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(SolicitudesPage);
    fixture.detectChanges();

    httpMock
      .expectOne(esListado())
      .flush({ detail: 'se cayo' }, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    const reintentar = [...anfitrion.querySelectorAll('button')].find(
      (boton) => (boton.textContent ?? '').trim() === 'Reintentar',
    );
    expect(reintentar).toBeDefined();

    reintentar?.click();
    fixture.detectChanges();
    httpMock.expectOne(esListado()).flush([PENDIENTE]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('Terapia ocupacional');
    httpMock
      .match(RUTA_PERMISOS_EFECTIVOS)
      .forEach((peticion) => peticion.flush({ permissions: [] }));
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(): Promise<ComponentFixture<SolicitudesPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [PERMISO_CONSULTORIO_MANAGE],
    });

    const fixture = TestBed.createComponent(SolicitudesPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([PENDIENTE, APROBADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === LISTADO;
  }
});

function escribir(anfitrion: HTMLElement, selector: string, valor: string) {
  const campo = anfitrion.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
}

function elegir(anfitrion: HTMLElement, selector: string, valor: string) {
  const campo = anfitrion.querySelector<HTMLSelectElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el selector ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
}
