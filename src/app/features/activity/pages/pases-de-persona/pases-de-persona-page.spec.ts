import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import {
  CONSULTORIO,
  asentar,
  clickear,
  escribir,
  otorgar,
  proveerDiaDeLaSede,
  textoDe,
} from '../../testing/activity-testing';
import { PasesDePersonaPage } from './pases-de-persona-page';

const PERSONA = 512;
const BASE = `/api/v1/consultorios/${CONSULTORIO}`;
const URL_PASES = `${BASE}/personas/${PERSONA}/pases`;

const PASE = {
  id: 77,
  nombre: 'Pack Pilates 8',
  creditosIniciales: 8,
  creditosDisponibles: 5,
  estado: 'ACTIVO',
  vigente: true,
  vigenciaDesde: '2026-10-01',
  vigenciaHasta: '2026-11-29',
  precio: 40000,
  moneda: 'ARS',
  vendidoEn: '2026-10-01T13:00:00Z',
};

const PRODUCTOS = [
  { id: 9, nombre: 'Pack Pilates 8', creditos: 8, precio: 40000, moneda: 'ARS', vigenciaDias: 60 },
  { id: 8, nombre: 'Pack viejo', active: false },
];

describe('PasesDePersonaPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasesDePersonaPage],
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

  function responderPases(pases: unknown[] = [PASE]) {
    httpMock.expectOne(URL_PASES).flush(pases);
    httpMock
      .expectOne(`/api/v1/personas/${PERSONA}`)
      .flush({ id: PERSONA, apellido: 'Gomez', nombre: 'Ana' });
  }

  const TODOS = ['pase:read', 'pase:manage', 'producto:read', 'cobro:register'];

  async function montar(pases: unknown[] = [PASE], productos: unknown[] = PRODUCTOS) {
    otorgar(httpMock, ...TODOS);
    const fixture = TestBed.createComponent(PasesDePersonaPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();
    responderPases(pases);
    httpMock.expectOne((r) => r.url === `${BASE}/productos`).flush(productos);
    await asentar(fixture);
    return fixture;
  }

  it(
    'lista los pases con saldo, vigencia y estado',
    async () => {
      const fixture = await montar();
      const texto = textoDe(fixture);
      expect(texto).toContain('Pases de Gomez, Ana');
      expect(texto).toContain('5 de 8');
      expect(texto).toContain('Del 01/10/2026 al 29/11/2026');
      expect(texto).toContain('Activo');
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('sin pases lo dice; solo ofrece productos vigentes para vender', async () => {
    const fixture = await montar([]);
    expect(textoDe(fixture)).toContain('no compro ningun pase en esta sede');
    const opciones = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('#vender-producto option'),
    ].map((o) => o.textContent?.replace(/\s+/g, ' ').trim());
    expect(opciones).toHaveLength(2);
    expect(opciones[1]).toContain('Pack Pilates 8 — 8 creditos');
  });

  it(
    'el ledger explica el saldo con signo y origen (CA-M29-009-06)',
    async () => {
      const fixture = await montar();
      clickear(fixture, 'Ver movimientos');
      httpMock.expectOne(`${BASE}/pases/77`).flush({
        pase: PASE,
        movimientos: [
          { id: 1, tipo: 'COMPRA', cantidad: 8, saldoResultante: 8, origenTipo: 'VENTA' },
          { id: 2, tipo: 'CONSUMO', cantidad: -1, saldoResultante: 7, origenTipo: 'ASISTENCIA' },
          {
            id: 3,
            tipo: 'DEVOLUCION',
            cantidad: 1,
            saldoResultante: 8,
            origenTipo: 'ASISTENCIA',
            motivo: 'Se corrigio a ausente',
          },
        ],
      });
      await asentar(fixture);
      const texto = textoDe(fixture);
      expect(texto).toContain('Saldo actual: 5 creditos de 8');
      expect(texto).toContain('Compra');
      expect(texto).toContain('+8');
      expect(texto).toContain('-1');
      expect(texto).toContain('asistencia a una clase');
      expect(texto).toContain('Motivo: Se corrigio a ausente');
      await esperarSinViolaciones(fixture.nativeElement);
      clickear(fixture, 'Cerrar movimientos');
      expect(textoDe(fixture)).not.toContain('Saldo actual');
    },
    TIMEOUT_AXE,
  );

  it('un ledger que falla lo dice', async () => {
    const fixture = await montar();
    clickear(fixture, 'Ver movimientos');
    httpMock
      .expectOne(`${BASE}/pases/77`)
      .flush({ status: 404 }, { status: 404, statusText: 'Not Found' });
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('no existe, o no es de esta sede');
  });

  it('vende con clave de intento, avisa la deuda y relee; el reintento usa la misma clave', async () => {
    const fixture = await montar([]);
    clickear(fixture, 'Vender pase');
    expect(textoDe(fixture)).toContain('Elegi el producto a vender.');
    httpMock.expectNone((r) => r.method === 'POST');

    escribir(fixture, '#vender-producto', '9');
    expect(textoDe(fixture)).toContain('Vale 60 dias desde hoy');
    clickear(fixture, 'Vender pase');
    const primero = httpMock.expectOne(`${BASE}/pases`);
    const clave = primero.request.body.idempotencyKey as string;
    expect(primero.request.body).toEqual({
      productoId: 9,
      personaId: PERSONA,
      idempotencyKey: clave,
    });
    primero.flush({ status: 503 }, { status: 503, statusText: 'Unavailable' });
    await asentar(fixture);

    clickear(fixture, 'Vender pase');
    const segundo = httpMock.expectOne(`${BASE}/pases`);
    expect(segundo.request.body.idempotencyKey).toBe(clave);
    segundo.flush({
      creada: true,
      pase: { ...PASE, creditosDisponibles: 8 },
      deuda: { importe: 40000, moneda: 'ARS', estado: 'PENDIENTE' },
    });
    responderPases([PASE]);
    await asentar(fixture);
    const texto = textoDe(fixture);
    expect(texto).toContain('Se vendio "Pack Pilates 8": 8 creditos hasta el 29/11/2026');
    expect(texto).toContain('Quedo una deuda de');
    expect(texto).toContain('Cobrar desde la cuenta corriente');
  });

  it('producto no vendible muestra el motivo del servidor', async () => {
    const fixture = await montar([]);
    escribir(fixture, '#vender-producto', '9');
    clickear(fixture, 'Vender pase');
    httpMock.expectOne(`${BASE}/pases`).flush(
      {
        type: 'https://akine.app/problems/producto-no-vendible',
        status: 409,
        detail: 'El producto se vende desde el 01/11/2026.',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('El producto se vende desde el 01/11/2026.');
  });

  it('sin pase:manage no ofrece vender ni pide productos; sin cobro:register no enlaza la cuenta', async () => {
    otorgar(httpMock, 'pase:read');
    const fixture = TestBed.createComponent(PasesDePersonaPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();
    responderPases();
    await asentar(fixture);
    expect(textoDe(fixture)).not.toContain('Vender un pase');
    expect(textoDe(fixture)).not.toContain('Cuenta corriente');
    httpMock.expectNone((r) => r.url === `${BASE}/productos`);
  });

  it('un listado que falla ofrece reintentar', async () => {
    otorgar(httpMock, ...TODOS);
    const fixture = TestBed.createComponent(PasesDePersonaPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();
    httpMock.expectOne(URL_PASES).flush({ status: 404 }, { status: 404, statusText: 'Not Found' });
    httpMock
      .expectOne(`/api/v1/personas/${PERSONA}`)
      .flush({ status: 404 }, { status: 404, statusText: 'Not Found' });
    httpMock.expectOne((r) => r.url === `${BASE}/productos`).flush([]);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Pases de Persona #512');
    expect(textoDe(fixture)).toContain('No se pudieron leer los pases');
    clickear(fixture, 'Reintentar');
    responderPases();
    await asentar(fixture as ComponentFixture<PasesDePersonaPage>);
    expect(textoDe(fixture)).toContain('5 de 8');
  });
});
