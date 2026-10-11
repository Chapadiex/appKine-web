import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConsumoDeAutorizacion } from './consumo-de-autorizacion';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const AUTORIZACION = 600;
const BASE = `/api/v1/autorizaciones/${AUTORIZACION}`;

const SALDO = {
  autorizacionId: AUTORIZACION,
  cantidadAutorizada: 10,
  cantidadConsumida: 2,
  consumidaSegunElLedger: 2,
  saldo: 8,
  saldoSegunElLedger: 8,
  coherente: true,
  consumosARevisar: 1,
  habilita: true,
  vigente: true,
  vencida: false,
  agotada: false,
  fecha: '2026-10-11',
  movimientos: 4,
};

/** Dos consumos, uno ya revertido; el otro tiene una alerta pendiente por la deuda anulada. */
const MOVIMIENTOS = [
  {
    id: 1,
    tipo: 'CONSUMO',
    tipoOrigen: 'SESION',
    referenciaOrigen: 70,
    cantidad: 1,
    efectoSobreElSaldo: -1,
    ocurrioEn: '2026-10-01T13:00:00Z',
  },
  {
    id: 2,
    tipo: 'REVERSION',
    tipoOrigen: 'SESION',
    referenciaOrigen: 70,
    movimientoOrigenId: 1,
    cantidad: 1,
    efectoSobreElSaldo: 1,
    motivo: 'Error de carga',
    ocurrioEn: '2026-10-02T13:00:00Z',
  },
  {
    id: 3,
    tipo: 'CONSUMO',
    tipoOrigen: 'SESION',
    referenciaOrigen: 71,
    cantidad: 1,
    efectoSobreElSaldo: -1,
    ocurrioEn: '2026-10-05T13:00:00Z',
  },
];

const ALERTAS = [
  {
    id: 9,
    tipo: 'CONSUMO_A_REVISAR',
    autorizacionId: AUTORIZACION,
    movimientoId: 3,
    sesionId: 71,
    obligacionId: 880,
    motivoOrigen: 'Cortesia del centro',
    pendiente: true,
    generadaEn: '2026-10-06T13:00:00Z',
  },
];

/**
 * Saldo explicable, ledger y alertas de una autorizacion (C-4, D-f).
 *
 * <p>Lo que importa: el consumo ya revertido NO ofrece revertir de nuevo, la alerta pendiente
 * ofrece la unica accion que el contrato tiene —revertir— y la reversion viaja con el movimiento y
 * el motivo, relee y avisa al listado.
 */
describe('ConsumoDeAutorizacion', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ConsumoDeAutorizacion],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_PACIENTE_MANAGE] });
  });

  afterEach(() => httpMock.verify());

  it(
    'explica el saldo, la alerta pendiente y el ledger, sin ofrecer revertir lo ya revertido',
    async () => {
      const fixture = await montar();
      const contenido = texto(fixture);

      expect(contenido).toContain('Saldo y consumos de la autorizacion AUT-1');
      expect(contenido).toContain('Otorgadas');
      expect(contenido).toContain('Consumos a revisar');
      expect(contenido).toContain('Habilita a atender');
      expect(contenido).toContain('Se anulo la deuda de la sesion #71 (obligacion #880)');
      expect(contenido).toContain('Motivo de la anulacion: Cortesia del centro');
      expect(contenido).toContain('No hay forma de descartar la alerta sin revertir');
      expect(contenido).toContain('Cierre de la sesion #70');
      expect(contenido).toContain('Compensa el consumo #1');
      expect(contenido).toContain('Motivo: Error de carga');
      expect(contenido).toContain('Ya revertido');
      expect(contenido).not.toContain('Las dos cuentas del saldo no coinciden');

      // El consumo #1 ya tiene su reversion: solo el #3 se ofrece, desde la alerta y desde el ledger.
      const botones = rotulos(fixture);
      expect(botones).not.toContain('Revertir el consumo #1');
      expect(botones.filter((b) => b === 'Revertir el consumo #3')).toHaveLength(2);

      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  it('revierte con movimiento y motivo, relee y avisa al listado', async () => {
    const fixture = await montar();
    let avisos = 0;
    fixture.componentInstance.revertido.subscribe(() => avisos++);

    apretar(fixture, 'Revertir el consumo #3');
    const motivo = fixture.nativeElement.querySelector('#revertir-consumo-3') as HTMLInputElement;
    motivo.value = 'La sesion no se presto';
    motivo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    apretar(fixture, 'Confirmar la reversion');

    const pedido = httpMock.expectOne(
      (p) => p.method === 'POST' && p.url === `${BASE}/reversiones`,
    );
    expect(pedido.request.body).toEqual({ movimientoId: 3, motivo: 'La sesion no se presto' });
    pedido.flush({ id: 4, tipo: 'REVERSION', movimientoOrigenId: 3 });

    responderLectura({ ...SALDO, consumosARevisar: 0, saldo: 9, cantidadConsumida: 1 });
    await estabilizar(fixture);

    expect(avisos).toBe(1);
    expect(texto(fixture)).toContain('Se revirtio el consumo #3');
  });

  it('muestra el rechazo de una reversion repetida y la incoherencia del saldo', async () => {
    const fixture = await montar({
      ...SALDO,
      coherente: false,
      consumidaSegunElLedger: 3,
    });
    expect(texto(fixture)).toContain('Las dos cuentas del saldo no coinciden');

    apretar(fixture, 'Revertir el consumo #3');
    const motivo = fixture.nativeElement.querySelector('#revertir-consumo-3') as HTMLInputElement;
    motivo.value = 'Duplicado';
    motivo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    apretar(fixture, 'Confirmar la reversion');

    httpMock
      .expectOne((p) => p.method === 'POST' && p.url === `${BASE}/reversiones`)
      .flush(
        {
          type: 'https://akine.app/problems/movimiento-ya-revertido',
          title: 'Ya revertido',
          status: 409,
        },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('Ese consumo ya estaba revertido');
    apretar(fixture, 'Cancelar');
    expect(texto(fixture)).not.toContain('Ese consumo ya estaba revertido');
  });

  it('un error de lectura ofrece reintentar', async () => {
    const fixture = TestBed.createComponent(ConsumoDeAutorizacion);
    fixture.componentRef.setInput('autorizacionId', AUTORIZACION);
    fixture.detectChanges();
    httpMock
      .expectOne(esGet('/saldo'))
      .flush({ status: 500 }, { status: 500, statusText: 'Server Error' });
    httpMock.match(esGet('/movimientos'));
    httpMock.match(esGet('/alertas'));
    await estabilizar(fixture);

    apretar(fixture, 'Reintentar');
    responderLectura(SALDO, [], []);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Todavia no consumio ninguna sesion');
    expect(texto(fixture)).toContain('No hay consumos a revisar');
  });

  async function montar(saldo: object = SALDO): Promise<ComponentFixture<ConsumoDeAutorizacion>> {
    const fixture = TestBed.createComponent(ConsumoDeAutorizacion);
    fixture.componentRef.setInput('autorizacionId', AUTORIZACION);
    fixture.componentRef.setInput('numero', 'AUT-1');
    fixture.detectChanges();
    responderLectura(saldo);
    await estabilizar(fixture);
    return fixture;
  }

  function responderLectura(
    saldo: object,
    movimientos: object[] = MOVIMIENTOS,
    alertas: object[] = ALERTAS,
  ): void {
    httpMock.expectOne(esGet('/saldo')).flush(saldo);
    httpMock.expectOne(esGet('/movimientos')).flush(movimientos);
    httpMock.expectOne(esGet('/alertas')).flush(alertas);
  }

  function esGet(sufijo: string) {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === `${BASE}${sufijo}`;
  }

  async function estabilizar(fixture: ComponentFixture<ConsumoDeAutorizacion>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function rotulos(fixture: ComponentFixture<ConsumoDeAutorizacion>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((boton) => (boton.textContent ?? '').trim());
  }

  function apretar(fixture: ComponentFixture<ConsumoDeAutorizacion>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<ConsumoDeAutorizacion>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
