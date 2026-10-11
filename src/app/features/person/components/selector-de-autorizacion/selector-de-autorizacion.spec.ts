import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SelectorDeAutorizacion } from './selector-de-autorizacion';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERSONA = 7;
const ELEGIBLES = `/api/v1/personas/${PERSONA}/autorizaciones/elegibles`;

const KINESIO = { id: 55, name: 'Kinesiologia', tipo: 'PRACTICA', estado: 'ACTIVO' };
const FONO = { id: 56, name: 'Fonoaudiologia', tipo: 'PRACTICA', estado: 'ACTIVO' };

/**
 * En el orden del backend: primero las que habilitan y, dentro, la que vence antes. La de
 * fonoaudiologia vence antes que las dos de kinesiologia, y es justamente la trampa que C-4 corrigio
 * en 06.04: para una sesion de kinesiologia no sirve, aunque este primera.
 */
const CANDIDATAS = [
  {
    id: 1,
    numero: 'FONO-1',
    practicaId: FONO.id,
    habilita: true,
    cantidadAutorizada: 10,
    saldo: 4,
    vigenciaHasta: '2026-10-30',
    diasParaVencer: 19,
  },
  {
    id: 2,
    numero: 'KIN-1',
    practicaId: KINESIO.id,
    habilita: true,
    cantidadAutorizada: 20,
    saldo: 3,
    vigenciaHasta: '2026-11-30',
    diasParaVencer: 50,
    convenioNombre: 'OSDE 210',
  },
  {
    id: 3,
    numero: 'KIN-2',
    practicaId: KINESIO.id,
    habilita: true,
    cantidadAutorizada: 10,
    saldo: 10,
    vigenciaHasta: '2026-12-31',
    diasParaVencer: 81,
  },
  {
    id: 4,
    numero: 'KIN-VIEJA',
    practicaId: KINESIO.id,
    habilita: false,
    motivoNoElegible: 'VENCIDA',
    cantidadAutorizada: 10,
    saldo: 2,
    vigenciaHasta: '2026-09-30',
    diasParaVencer: -11,
  },
];

describe('SelectorDeAutorizacion', () => {
  let httpMock: HttpTestingController;
  let contexto: TenantContextStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SelectorDeAutorizacion],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    contexto = TestBed.inject(TenantContextStore);
    contexto.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => httpMock.verify());

  it(
    'para una practica dice de cual se descontaria y por que no de las otras',
    async () => {
      const fixture = montar();
      elegir(fixture, '#selector-practica', String(KINESIO.id));
      escribir(fixture, '#selector-fecha', '2026-10-11');
      apretar(fixture, 'Ver candidatas');

      const pedido = httpMock.expectOne((p) => p.url === ELEGIBLES);
      expect(pedido.request.params.get('fecha')).toBe('2026-10-11');
      pedido.flush(CANDIDATAS);
      await estabilizar(fixture);

      const contenido = texto(fixture);
      expect(contenido).toContain('Se descontaria de la KIN-1');
      expect(contenido).toContain('La que se usaria');
      expect(contenido).toContain('Tambien sirve, pero vence despues que la KIN-1');
      expect(contenido).toContain('No sirve: esta vencida');
      expect(contenido).toContain('Convenio OSDE 210');
      expect(contenido).toContain('cobertura no este vigente');
      // La de fonoaudiologia vence antes, pero es de otra practica: no se muestra ni se elige.
      expect(contenido).not.toContain('FONO-1');
      expect(contenido).toContain('1 autorizacion(es) de otras practicas no se muestran');

      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  it('sin practica muestra todas, sin elegir ninguna, y consulta contra hoy', async () => {
    const fixture = montar();
    apretar(fixture, 'Ver candidatas');
    const pedido = httpMock.expectOne((p) => p.url === ELEGIBLES);
    expect(pedido.request.params.has('fecha')).toBe(false);
    pedido.flush(CANDIDATAS);
    await estabilizar(fixture);

    const contenido = texto(fixture);
    expect(contenido).toContain('FONO-1');
    expect(contenido).toContain('Fonoaudiologia');
    expect(contenido).not.toContain('La que se usaria');
  });

  it('cuando ninguna sirve lo dice, y el cambio de sede borra la respuesta', async () => {
    const fixture = montar();
    elegir(fixture, '#selector-practica', String(FONO.id));
    apretar(fixture, 'Ver candidatas');
    httpMock
      .expectOne((p) => p.url === ELEGIBLES)
      .flush([{ ...CANDIDATAS[0], habilita: false, motivoNoElegible: 'AGOTADA', saldo: 0 }]);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Ninguna autorizacion sirve para esta practica');
    expect(texto(fixture)).toContain('ya se consumieron todas');

    contexto.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 4,
      consultorioName: 'Sede Norte',
    });
    await estabilizar(fixture);
    expect(texto(fixture)).not.toContain('Ninguna autorizacion sirve');
  });

  it('un paciente sin autorizaciones y un error se distinguen', async () => {
    const fixture = montar();
    apretar(fixture, 'Ver candidatas');
    httpMock.expectOne((p) => p.url === ELEGIBLES).flush([]);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('no tiene autorizaciones activas');

    apretar(fixture, 'Ver candidatas');
    httpMock
      .expectOne((p) => p.url === ELEGIBLES)
      .flush({ status: 404 }, { status: 404, statusText: 'Not Found' });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('no es de esta organizacion');
  });

  function montar(): ComponentFixture<SelectorDeAutorizacion> {
    const fixture = TestBed.createComponent(SelectorDeAutorizacion);
    fixture.componentRef.setInput('personaId', PERSONA);
    fixture.componentRef.setInput('practicas', [KINESIO, FONO]);
    fixture.detectChanges();
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<SelectorDeAutorizacion>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function elegir(
    fixture: ComponentFixture<SelectorDeAutorizacion>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<SelectorDeAutorizacion>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<SelectorDeAutorizacion>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<SelectorDeAutorizacion>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
