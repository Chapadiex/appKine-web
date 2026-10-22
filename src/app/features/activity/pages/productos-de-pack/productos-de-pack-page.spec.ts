import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import {
  CONSULTORIO,
  URL_OFERTAS,
  asentar,
  clickear,
  elegirSede,
  escribir,
  otorgar,
  proveerDiaDeLaSede,
  textoDe,
} from '../../testing/activity-testing';
import { ProductosDePackPage } from './productos-de-pack-page';

const URL_PRODUCTOS = `/api/v1/consultorios/${CONSULTORIO}/productos`;

const OFERTAS = [
  { id: 42, nombreComercial: 'Pilates reformer', esquemaCobro: 'POR_PACK', estado: 'ACTIVO' },
  { id: 43, nombreComercial: 'Kinesio', esquemaCobro: 'POR_SESION', estado: 'ACTIVO' },
  { id: 44, nombreComercial: 'Gimnasio libre', esquemaCobro: 'POR_ABONO', estado: 'ACTIVO' },
];

const PACK = {
  id: 9,
  ofertaId: 42,
  nombre: 'Pack Pilates 8',
  creditos: 8,
  precio: 40000,
  moneda: 'ARS',
  vigenciaDias: 60,
  vigenciaDesde: '2026-10-01',
  active: true,
  version: 3,
};

describe('ProductosDePackPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProductosDePackPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        proveerDiaDeLaSede(),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function responder(productos: unknown[] = [PACK], incluirBajas = false) {
    const pedido = httpMock.expectOne((r) => r.url === URL_PRODUCTOS && r.method === 'GET');
    expect(pedido.request.params.get('incluirBajas')).toBe(String(incluirBajas));
    pedido.flush(productos);
    httpMock.expectOne((r) => r.url === URL_OFERTAS).flush(OFERTAS);
  }

  async function montar(productos: unknown[] = [PACK]) {
    elegirSede();
    const fixture = TestBed.createComponent(ProductosDePackPage);
    fixture.detectChanges();
    responder(productos);
    await asentar(fixture);
    return fixture;
  }

  it(
    'lista los productos con su oferta, precio y ventana comercial',
    async () => {
      const fixture = await montar();
      const texto = textoDe(fixture);
      expect(texto).toContain('Pack Pilates 8');
      expect(texto).toContain('Pilates reformer');
      expect(texto).toContain('8 creditos');
      expect(texto).toContain('40.000');
      expect(texto).toContain('Desde el 01/10/2026, sin fin');
      expect(texto).toContain('Vigente');
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('sin productos lo dice; el alta ofrece las ofertas del esquema de cada tipo', async () => {
    const fixture = await montar([]);
    expect(textoDe(fixture)).toContain('no tiene productos vigentes');
    clickear(fixture, 'Nuevo producto');
    const opciones = () =>
      [...(fixture.nativeElement as HTMLElement).querySelectorAll('#producto-oferta option')].map(
        (o) => o.textContent?.trim(),
      );
    expect(opciones()).toEqual(['Elegí una oferta', 'Pilates reformer']);
    escribir(fixture, '#producto-oferta', '42');
    escribir(fixture, '#producto-tipo', 'ABONO');
    expect(opciones()).toEqual(['Elegí una oferta', 'Gimnasio libre']);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('#producto-oferta')
        ?.value,
    ).toBe('');
    expect(textoDe(fixture)).toContain('Asistencias por periodo');
    expect(textoDe(fixture)).toContain('Días maximos del periodo');
  });

  it('crea un abono sobre una oferta POR_ABONO (RF-M29-007)', async () => {
    const fixture = await montar([]);
    clickear(fixture, 'Nuevo producto');
    escribir(fixture, '#producto-tipo', 'ABONO');
    escribir(fixture, '#producto-oferta', '44');
    escribir(fixture, '#producto-nombre', 'Abono mensual');
    escribir(fixture, '#producto-creditos', '12');
    escribir(fixture, '#producto-precio', '30000');
    escribir(fixture, '#producto-vigencia-dias', '31');
    clickear(fixture, 'Crear producto');
    const pedido = httpMock.expectOne((r) => r.url === URL_PRODUCTOS && r.method === 'POST');
    expect(pedido.request.body).toEqual(
      expect.objectContaining({ tipo: 'ABONO', ofertaId: 44, creditos: 12, vigenciaDias: 31 }),
    );
    pedido.flush({ ...PACK, id: 11, nombre: 'Abono mensual', tipo: 'ABONO', ofertaId: 44 });
    responder([{ ...PACK, id: 11, nombre: 'Abono mensual', tipo: 'ABONO', ofertaId: 44 }]);
    await asentar(fixture);
    const texto = textoDe(fixture);
    expect(texto).toContain('Se creo "Abono mensual" (abono)');
    expect(texto).toContain('Periodo de hasta 60 días');
    expect(texto).toContain('Abono');
  });

  it(
    'crea un producto con el cuerpo del contrato y relee',
    async () => {
      const fixture = await montar([]);
      clickear(fixture, 'Nuevo producto');
      await esperarSinViolaciones(fixture.nativeElement);
      escribir(fixture, '#producto-oferta', '42');
      escribir(fixture, '#producto-nombre', ' Pack 4 ');
      escribir(fixture, '#producto-creditos', '4');
      escribir(fixture, '#producto-precio', '20000,50');
      escribir(fixture, '#producto-vigencia-dias', '30');
      clickear(fixture, 'Crear producto');

      const pedido = httpMock.expectOne((r) => r.url === URL_PRODUCTOS && r.method === 'POST');
      expect(pedido.request.body).toEqual({
        ofertaId: 42,
        nombre: 'Pack 4',
        creditos: 4,
        precio: 20000.5,
        moneda: 'ARS',
        vigenciaDias: 30,
        vigenciaDesde: '2026-10-14',
        tipo: 'PACK',
      });
      pedido.flush({ ...PACK, id: 10, nombre: 'Pack 4' });
      responder([PACK]);
      await asentar(fixture);
      expect(textoDe(fixture)).toContain('Se creo "Pack 4". Todavía nadie tiene saldo');
    },
    TIMEOUT_AXE,
  );

  it('el alta se abre con el foco adentro y "Cancelar" lo devuelve a "Nuevo producto"', async () => {
    const fixture = await montar([]);
    clickear(fixture, 'Nuevo producto');
    await asentar(fixture);
    expect(document.activeElement?.closest('form')).not.toBeNull();
    expect(document.activeElement?.tagName).toMatch(/INPUT|SELECT/);

    const cancelar = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button[type="button"]'),
    ).find((b) => b.textContent?.trim() === 'Cancelar') as HTMLButtonElement;
    cancelar.click();
    await asentar(fixture);
    expect(document.activeElement?.id).toBe('boton-nuevo-producto');
  });

  it('un formulario incompleto no sale a la red', async () => {
    const fixture = await montar([]);
    clickear(fixture, 'Nuevo producto');
    clickear(fixture, 'Crear producto');
    expect(textoDe(fixture)).toContain('Elegí la oferta del producto.');
    expect(textoDe(fixture)).toContain('El nombre es obligatorio.');
    httpMock.expectNone((r) => r.method === 'POST');
  });

  it('una vigencia de mas de diez anios no sale a la red y el error queda asociado (0.120.0)', async () => {
    const fixture = await montar([]);
    clickear(fixture, 'Nuevo producto');
    escribir(fixture, '#producto-vigencia-dias', '4000');
    clickear(fixture, 'Crear producto');
    expect(textoDe(fixture)).toContain('Entre 1 y 3660 días.');
    const campo = (fixture.nativeElement as HTMLElement).querySelector('#producto-vigencia-dias');
    expect(campo?.getAttribute('aria-describedby')).toBe(
      'producto-vigencia-dias-ayuda producto-vigenciaDias-error',
    );
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('#producto-nombre')
        ?.getAttribute('aria-describedby'),
    ).toBe('producto-nombre-error');
    httpMock.expectNone((r) => r.method === 'POST');
  });

  it('el nombre en uso se explica', async () => {
    const fixture = await montar([]);
    clickear(fixture, 'Nuevo producto');
    escribir(fixture, '#producto-oferta', '42');
    escribir(fixture, '#producto-nombre', 'Pack Pilates 8');
    escribir(fixture, '#producto-creditos', '8');
    escribir(fixture, '#producto-precio', '1');
    escribir(fixture, '#producto-vigencia-dias', '60');
    clickear(fixture, 'Crear producto');
    httpMock
      .expectOne((r) => r.method === 'POST')
      .flush(
        { type: 'https://akine.app/problems/producto-nombre-en-uso', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Ya hay un producto vigente con ese nombre');
  });

  it('edita con la versión leida y limpia la fecha de fin vaciada', async () => {
    const fixture = await montar([{ ...PACK, vigenciaHasta: '2026-12-31' }]);
    clickear(fixture, 'Editar');
    expect(textoDe(fixture)).toContain('El tipo y la oferta de un producto no se cambia');
    escribir(fixture, '#producto-precio', '45000');
    escribir(fixture, '#producto-hasta', '');
    clickear(fixture, 'Guardar cambios');

    const pedido = httpMock.expectOne((r) => r.url === `${URL_PRODUCTOS}/9` && r.method === 'PUT');
    expect(pedido.request.body).toEqual(
      expect.objectContaining({ precio: 45000, version: 3, limpiarVigenciaHasta: true }),
    );
    expect(pedido.request.body.ofertaId).toBeUndefined();
    pedido.flush({ ...PACK, precio: 45000 });
    responder();
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Los pases ya vendidos no cambian.');
  });

  it('da de baja con motivo y avisa que no cascadea', async () => {
    const fixture = await montar();
    clickear(fixture, 'Dar de baja');
    escribir(fixture, '#producto-baja-motivo', 'Se discontinua');
    const form = (fixture.nativeElement as HTMLElement).querySelector(
      'akine-confirmacion-con-motivo form',
    ) as HTMLFormElement;
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const pedido = httpMock.expectOne(`${URL_PRODUCTOS}/9/baja`);
    expect(pedido.request.body).toEqual({ motivo: 'Se discontinua' });
    pedido.flush({ ...PACK, active: false });
    responder();
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Los pases vendidos conservan su saldo');
    // El aviso se lleva el foco: el panel de la baja ya no esta.
    expect(document.activeElement?.textContent).toContain('Los pases vendidos conservan su saldo');
  });

  it('incluir bajas relee con el filtro y muestra el motivo', async () => {
    const fixture = await montar();
    const casilla = (fixture.nativeElement as HTMLElement).querySelector(
      '#productos-incluir-bajas',
    ) as HTMLInputElement;
    casilla.checked = true;
    casilla.dispatchEvent(new Event('change'));
    responder([PACK, { ...PACK, id: 8, active: false, deactivationReason: 'Viejo' }], true);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Dado de baja');
    expect(textoDe(fixture)).toContain('Motivo: Viejo');
  });

  it('sin producto:manage no ofrece alta ni acciones', async () => {
    const httpCtl = httpMock;
    otorgar(httpCtl, 'producto:read');
    const fixture = await montar();
    expect(textoDe(fixture)).not.toContain('Nuevo producto');
    expect(textoDe(fixture)).not.toContain('Dar de baja');
  });

  it('un listado que falla ofrece reintentar', async () => {
    elegirSede();
    const fixture = TestBed.createComponent(ProductosDePackPage);
    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.url === URL_PRODUCTOS)
      .flush({ status: 403 }, { status: 403, statusText: 'Forbidden' });
    httpMock.expectOne((r) => r.url === URL_OFERTAS).flush(OFERTAS);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('No tenés permiso');
    clickear(fixture, 'Reintentar');
    responder();
    await asentar(fixture as ComponentFixture<ProductosDePackPage>);
    expect(textoDe(fixture)).toContain('Pack Pilates 8');
  });
});
