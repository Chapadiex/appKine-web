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
  version: 4,
};

const ABONO = {
  id: 10,
  nombre: 'Abono mensual',
  tipo: 'ABONO',
  creditos: 12,
  precio: 30000,
  moneda: 'ARS',
  vigenciaDias: 31,
};

const PRODUCTOS = [
  { id: 9, nombre: 'Pack Pilates 8', creditos: 8, precio: 40000, moneda: 'ARS', vigenciaDias: 60 },
  { id: 8, nombre: 'Pack viejo', active: false },
  ABONO,
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

  async function montar(
    pases: unknown[] = [PASE],
    productos: unknown[] = PRODUCTOS,
    permisos: readonly string[] = TODOS,
  ) {
    otorgar(httpMock, ...permisos);
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
    expect(opciones).toHaveLength(3);
    expect(opciones[1]).toContain('Pack Pilates 8 — 8 creditos');
    expect(opciones[2]).toContain('Abono mensual — abono, 12 creditos');
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

  // ---------------------------------------------------------------- 08.07 / 08.08

  const ADMIN = [...TODOS, 'pase:adjust'];
  const PROBLEMA = 'https://akine.app/problems';

  function conflicto(tipo: string, extras: Record<string, unknown> = {}) {
    return [
      { type: `${PROBLEMA}/${tipo}`, status: 409, detail: 'Detalle tecnico.', ...extras },
      { status: 409, statusText: 'Conflict' },
    ] as const;
  }

  it('vende un abono con su periodo; cambiar el periodo cambia la clave', async () => {
    const fixture = await montar([]);
    escribir(fixture, '#vender-producto', '10');
    expect(textoDe(fixture)).toContain('Abono: cubre 12 creditos en un periodo de hasta 31 dias');
    const desde = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#vender-periodo-desde',
    );
    expect(desde?.value).toBe('2026-10-14');

    escribir(fixture, '#vender-periodo-hasta', '2026-10-01');
    clickear(fixture, 'Vender pase');
    expect(textoDe(fixture)).toContain('no puede ser anterior al primero');
    httpMock.expectNone((r) => r.method === 'POST');

    escribir(fixture, '#vender-periodo-hasta', '');
    clickear(fixture, 'Vender pase');
    const primero = httpMock.expectOne(`${BASE}/pases`);
    expect(primero.request.body).toEqual(
      expect.objectContaining({ productoId: 10, periodoDesde: '2026-10-14' }),
    );
    expect(primero.request.body.periodoHasta).toBeUndefined();
    const clave = primero.request.body.idempotencyKey as string;
    primero.flush(...conflicto('abono-periodo-superpuesto'));
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('ya tiene ese abono en un periodo que se superpone');

    escribir(fixture, '#vender-periodo-desde', '2026-11-14');
    clickear(fixture, 'Vender pase');
    const segundo = httpMock.expectOne(`${BASE}/pases`);
    expect(segundo.request.body.periodoDesde).toBe('2026-11-14');
    expect(segundo.request.body.idempotencyKey).not.toBe(clave);
    segundo.flush({
      creada: true,
      pase: {
        ...PASE,
        tipo: 'ABONO',
        nombre: 'Abono mensual',
        vigenciaDesde: '2026-11-14',
        vigenciaHasta: '2026-12-14',
      },
    });
    responderPases([PASE]);
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('del 14/11/2026 al 14/12/2026');
  });

  it(
    'el estado es el del backend: VENCIDO, ANULADO con motivo y un abono que todavia no empieza',
    async () => {
      const fixture = await montar([
        { ...PASE, id: 1, estado: 'VENCIDO', vigente: false, creditosDisponibles: 0 },
        {
          ...PASE,
          id: 2,
          estado: 'ANULADO',
          vigente: false,
          anuladoEn: '2026-10-02T13:00:00Z',
          motivoAnulacion: 'Vendido por error',
        },
        {
          ...PASE,
          id: 3,
          tipo: 'ABONO',
          estado: 'ACTIVO',
          vigente: false,
          vigenciaDesde: '2026-11-01',
          vigenciaHasta: '2026-11-30',
        },
      ]);
      const texto = textoDe(fixture);
      expect(texto).toContain('Vencido');
      expect(texto).toContain('Anulado');
      expect(texto).toContain('Motivo: Vendido por error');
      expect(texto).toContain('Periodo del 01/11/2026 al 30/11/2026');
      expect(texto).toContain('Empieza el 01/11/2026');
      // Sin pase:adjust no hay ajuste ni anulacion.
      expect(texto).not.toContain('Ajustar saldo');
      expect(texto).not.toContain('Anular');
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('el ledger explica la devolucion por cancelacion y el vencimiento', async () => {
    const fixture = await montar();
    clickear(fixture, 'Ver movimientos');
    httpMock.expectOne(`${BASE}/pases/77`).flush({
      pase: PASE,
      movimientos: [
        { id: 1, tipo: 'COMPRA', cantidad: 8, saldoResultante: 8, origenTipo: 'VENTA' },
        { id: 2, tipo: 'CONSUMO', cantidad: -1, saldoResultante: 7, origenTipo: 'ASISTENCIA' },
        { id: 3, tipo: 'DEVOLUCION', cantidad: 1, saldoResultante: 8, origenTipo: 'CANCELACION' },
        { id: 4, tipo: 'VENCIMIENTO', cantidad: -8, saldoResultante: 0, origenTipo: 'VENCIMIENTO' },
      ],
    });
    await asentar(fixture);
    const texto = textoDe(fixture);
    expect(texto).toContain('se cancelo la clase: el credito vuelve al pase');
    expect(texto).toContain('vencio el pase: los creditos que quedaban se pierden');
    expect(texto).toContain('-8');
  });

  it(
    'ajusta el saldo con motivo y version; fuera de rango no sale a la red',
    async () => {
      const fixture = await montar([PASE], PRODUCTOS, ADMIN);
      clickear(fixture, 'Ver movimientos');
      httpMock.expectOne(`${BASE}/pases/77`).flush({ pase: PASE, movimientos: [] });
      await asentar(fixture);
      clickear(fixture, 'Ajustar saldo');
      await esperarSinViolaciones(fixture.nativeElement);

      escribir(fixture, '#ajuste-cantidad', '4');
      expect(textoDe(fixture)).toContain('El saldo tiene que quedar entre 0 y 8.');
      clickear(fixture, 'Ajustar saldo');
      expect(textoDe(fixture)).toContain('El motivo es obligatorio');
      httpMock.expectNone((r) => r.method === 'POST');

      escribir(fixture, '#ajuste-cantidad', '0');
      expect(textoDe(fixture)).toContain('Un numero entero distinto de cero.');
      escribir(fixture, '#ajuste-cantidad', '-5');
      expect(textoDe(fixture)).toContain('El saldo quedaria en 0 de 8.');
      escribir(fixture, '#ajuste-motivo', ' Cortesia ');
      clickear(fixture, 'Ajustar saldo');
      const pedido = httpMock.expectOne(`${BASE}/pases/77/ajustes`);
      expect(pedido.request.body).toEqual({ cantidad: -5, motivo: 'Cortesia', version: 4 });
      pedido.flush({
        pase: { ...PASE, creditosDisponibles: 0, version: 5 },
        movimientos: [
          {
            id: 9,
            tipo: 'AJUSTE',
            cantidad: -5,
            saldoResultante: 0,
            origenTipo: 'AJUSTE_MANUAL',
            motivo: 'Cortesia',
          },
        ],
      });
      responderPases([{ ...PASE, creditosDisponibles: 0, version: 5 }]);
      await asentar(fixture);
      const texto = textoDe(fixture);
      expect(texto).toContain('ahora tiene 0 creditos de 8');
      expect(texto).toContain('ajuste manual');
      expect(texto).toContain('Motivo: Cortesia');
    },
    TIMEOUT_AXE,
  );

  it('un ajuste rechazado muestra el motivo; la version vieja relee', async () => {
    const fixture = await montar([PASE], PRODUCTOS, ADMIN);
    clickear(fixture, 'Ajustar saldo');
    escribir(fixture, '#ajuste-cantidad', '1');
    escribir(fixture, '#ajuste-motivo', 'Error de carga');
    clickear(fixture, 'Ajustar saldo');
    httpMock
      .expectOne(`${BASE}/pases/77/ajustes`)
      .flush(...conflicto('pase-no-ajustable', { motivo: 'su vigencia termino el 2026-10-10' }));
    await asentar(fixture);
    expect(textoDe(fixture)).toContain(
      'No se puede: el pase su vigencia termino el 2026-10-10. No se cambio nada.',
    );

    clickear(fixture, 'Ajustar saldo');
    httpMock.expectOne(`${BASE}/pases/77/ajustes`).flush(...conflicto('concurrent-modification'));
    responderPases();
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('Alguien lo modifico mientras lo editabas');
    clickear(fixture, 'Cancelar');
    expect(textoDe(fixture)).not.toContain('Ajustar el saldo de');
  });

  it(
    'anula el pase y explica que la deuda queda anulada, no borrada',
    async () => {
      const fixture = await montar([PASE], PRODUCTOS, ADMIN);
      clickear(fixture, 'Anular');
      await esperarSinViolaciones(fixture.nativeElement);
      expect(textoDe(fixture)).toContain('queda anulada, no borrada');
      escribir(fixture, '#anulacion-motivo', 'Vendido por error');
      clickear(fixture, 'Anular pase');
      const pedido = httpMock.expectOne(`${BASE}/pases/77/anulacion`);
      expect(pedido.request.body).toEqual({ motivo: 'Vendido por error', version: 4 });
      pedido.flush({
        anulado: true,
        pase: { ...PASE, estado: 'ANULADO', creditosDisponibles: 0 },
        deuda: { importe: 40000, moneda: 'ARS', estado: 'ANULADA' },
      });
      responderPases([{ ...PASE, estado: 'ANULADO', creditosDisponibles: 0 }]);
      await asentar(fixture);
      const texto = textoDe(fixture);
      expect(texto).toContain('Se anulo "Pack Pilates 8" y su saldo se descarto.');
      expect(texto).toContain('quedo anulada: no se borra, sigue en la cuenta corriente');
      // Un pase anulado ya no ofrece anularse ni ajustarse.
      expect(texto).not.toContain('Ajustar saldo');
    },
    TIMEOUT_AXE,
  );

  it('la anulacion repetida y la venta sin deuda se dicen', async () => {
    const fixture = await montar([PASE], PRODUCTOS, ADMIN);
    clickear(fixture, 'Anular');
    escribir(fixture, '#anulacion-motivo', 'Otra vez');
    clickear(fixture, 'Anular pase');
    httpMock
      .expectOne(`${BASE}/pases/77/anulacion`)
      .flush({ anulado: false, pase: { ...PASE, estado: 'ANULADO' } });
    responderPases();
    await asentar(fixture);
    expect(textoDe(fixture)).toContain('ya estaba anulado: no se cambio nada');
    expect(textoDe(fixture)).toContain('La venta no tenia deuda.');
  });

  it('una deuda con cobros no deja anular y lleva a la cuenta corriente', async () => {
    const fixture = await montar([PASE], PRODUCTOS, ADMIN);
    clickear(fixture, 'Anular');
    escribir(fixture, '#anulacion-motivo', 'Vendido por error');
    clickear(fixture, 'Anular pase');
    httpMock
      .expectOne(`${BASE}/pases/77/anulacion`)
      .flush(...conflicto('pase-con-cobros', { obligacionId: 5, cobrado: 15000 }));
    await asentar(fixture);
    const texto = textoDe(fixture);
    expect(texto).toContain('la deuda de esta venta ya tiene cobros (15.000,00 cobrados)');
    expect(texto).toContain('Ir a la cuenta corriente');
  });
});
