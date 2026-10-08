import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';

import { PracticasDeLaOfertaPage } from './practicas-de-la-oferta-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS, rutaOfertas } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;
const OFERTA = 31;
const PRACTICAS = `${rutaOfertas(SEDE)}/${OFERTA}/practicas`;
const CATALOGO = '/api/v1/catalogos/practicas';

const CARGADA = {
  ofertaId: OFERTA,
  ofertaVersion: 7,
  practicaPrincipalId: 100,
  practicas: [
    {
      id: 1,
      practicaId: 100,
      nombre: 'Fisiokinesioterapia',
      codigo: '25.01.01',
      principal: true,
      estado: 'ACTIVO',
      vigenteEnCatalogo: true,
    },
    {
      id: 2,
      practicaId: 101,
      nombre: 'Magnetoterapia',
      codigo: '25.01.09',
      principal: false,
      estado: 'ACTIVO',
      vigenteEnCatalogo: false,
    },
    {
      id: 3,
      practicaId: 102,
      nombre: 'Ultrasonido',
      principal: false,
      estado: 'INACTIVO',
      deactivationReason: 'Quitada de la oferta',
    },
  ],
};

/**
 * Practicas de una oferta (AKINE A-9, DP-11). Lo que importa: el PUT manda el conjunto entero con
 * la principal y la version de la OFERTA, y la principal nunca queda apuntando a una practica que
 * ya no esta en la lista.
 */
describe('PracticasDeLaOfertaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PracticasDeLaOfertaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ ofertaId: String(OFERTA) }) } },
        },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('muestra las activas con la principal, advierte la fuera de catalogo y lista las de baja', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);

    expect(contenido).toContain('devengo al financiador');
    expect(contenido).toContain('Fisiokinesioterapia');
    expect(contenido).toContain('(principal)');
    expect(contenido).toContain('El catalogo dio de baja esta practica');
    expect(contenido).toContain('Quitada de la oferta');
    expect(radio(fixture, 0).checked).toBe(true);
    // Sin cambios no hay nada que guardar.
    expect(botones(fixture, 'Guardar las practicas')[0].disabled).toBe(true);
  });

  it('agregar desde el catalogo, cambiar la principal y guardar manda el conjunto con la version', async () => {
    const fixture = await montar();

    escribir(fixture, '#buscar-practica', 'drenaje');
    enviar(fixture);
    const busqueda = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.url === CATALOGO,
    );
    expect(busqueda.request.params.get('q')).toBe('drenaje');
    expect(busqueda.request.params.get('estado')).toBe('ACTIVO');
    busqueda.flush({ content: [{ id: 200, name: 'Drenaje linfatico', codigo: '25.02.01' }] });
    await estabilizar(fixture);

    botones(fixture, 'Agregar')[0].click();
    fixture.detectChanges();
    expect(botones(fixture, 'Ya esta')).toHaveLength(1);

    radio(fixture, 2).click();
    fixture.detectChanges();
    botones(fixture, 'Guardar las practicas')[0].click();

    const reemplazo = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT' && peticion.url === PRACTICAS,
    );
    expect(reemplazo.request.body).toEqual({
      practicaIds: [100, 101, 200],
      practicaPrincipalId: 200,
      expectedVersion: 7,
    });
    reemplazo.flush({ ...CARGADA, ofertaVersion: 8, practicaPrincipalId: 200 });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Guardamos las practicas de la oferta.');
  });

  it('quitar la principal pasa la marca a la primera que queda; vaciar manda principal nula', async () => {
    const fixture = await montar();

    botones(fixture, 'Quitar')[0].click();
    fixture.detectChanges();
    expect(radio(fixture, 0).checked).toBe(true);
    expect(texto(fixture)).toContain('Magnetoterapia');

    botones(fixture, 'Quitar')[0].click();
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Una lista vacia NO significa "todas"');

    botones(fixture, 'Guardar las practicas')[0].click();
    const reemplazo = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );
    expect(reemplazo.request.body).toEqual({ practicaIds: [], expectedVersion: 7 });
    reemplazo.flush({ ofertaId: OFERTA, ofertaVersion: 8, practicas: [] });
    await estabilizar(fixture);
  });

  it('el 409 de version relee, y practica-no-utilizable explica que hay que sacarla', async () => {
    const fixture = await montar();

    botones(fixture, 'Quitar')[1].click();
    fixture.detectChanges();
    botones(fixture, 'Guardar las practicas')[0].click();
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/conflict', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    responderCarga();
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Alguien mas modifico esto');

    botones(fixture, 'Quitar')[1].click();
    fixture.detectChanges();
    botones(fixture, 'Guardar las practicas')[0].click();
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/practica-no-utilizable', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Sacala de la lista y volve a guardar');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(): Promise<ComponentFixture<PracticasDeLaOfertaPage>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(PracticasDeLaOfertaPage);
    fixture.detectChanges();
    responderCarga();
    await estabilizar(fixture);
    return fixture;
  }

  function responderCarga(): void {
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === PRACTICAS,
      )
      .flush(CARGADA);
  }
});

async function estabilizar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: ComponentFixture<unknown>): string {
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
}

function botones(fixture: ComponentFixture<unknown>, etiqueta: string): HTMLButtonElement[] {
  return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].filter(
    (boton) => (boton.textContent ?? '').trim() === etiqueta,
  );
}

function radio(fixture: ComponentFixture<unknown>, indice: number): HTMLInputElement {
  return (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
    'input[type="radio"]',
  )[indice];
}

function escribir(fixture: ComponentFixture<unknown>, selector: string, valor: string): void {
  const campo = (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLInputElement;
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function enviar(fixture: ComponentFixture<unknown>): void {
  (fixture.nativeElement as HTMLElement)
    .querySelector('form[novalidate]')
    ?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
