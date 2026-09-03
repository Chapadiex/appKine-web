import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ArancelEfectivoPage } from './arancel-efectivo-page';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import {
  RUTA_FINANCIADORES,
  RUTA_PERMISOS_EFECTIVOS,
  rutaArancelEfectivo,
  rutaPlanes,
} from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const SEDE = 3;
const EFECTIVO = rutaArancelEfectivo(SEDE);
const RUTA_PRACTICAS = '/api/v1/catalogos/practicas';

const OSDE = { id: 10, codigo: '410', nombre: 'OSDE', tipo: 'PREPAGA', estado: 'ACTIVO' };
const PLAN = { id: 100, financiadorId: 10, codigo: '210', nombre: 'Plan 210', estado: 'ACTIVO' };
const PRACTICA = { id: 55, codigo: 'KIN-01', name: 'Sesion de kinesiologia', tipo: 'PRACTICA' };

const RESUELTO = {
  resuelto: true,
  fecha: '2026-03-15',
  moneda: 'ARS',
  importeTotal: 12000,
  importeFinanciador: 9000,
  coseguro: 3000,
  arancelId: 900,
  arancelVigenciaDesde: '2026-01-01',
  arancelVigenciaHasta: '2026-06-30',
  convenioId: 7,
  convenioCodigo: 'CONV-OSDE-210',
  convenioNombre: 'OSDE 210 kinesiologia',
  convenioVigenciaDesde: '2026-01-01',
  convenioVigenciaHasta: '2026-12-31',
  requiereOrden: true,
  requiereAutorizacion: false,
  requiereCredencial: false,
  limiteSesionesMensual: 12,
};

/**
 * Spec de la consulta de arancel efectivo (M16, RF-M16-006 y RF-M16-010).
 *
 * <p>Toda la pantalla existe por un solo hecho del contrato: <b>el endpoint responde 200 aunque no
 * haya arancel</b>. Los casos comprueban que la pantalla lo respete, porque tratarlo como un error
 * no rompe nada tecnicamente y arruina la pantalla para su caso mas frecuente — la mayoria de los
 * pacientes se atienden como particulares.
 *
 * <ol>
 *   <li>`resuelto: false` NO puede pintar un cartel de error ni un vacio: tiene que explicar por
 *       que no hay precio.</li>
 *   <li>Los dos motivos mandan a hacer cosas distintas y tienen que decirse distinto.</li>
 *   <li>Cuando si resuelve, tiene que venir la <b>derivacion</b>: sin ella un importe inesperado
 *       no se puede explicar.</li>
 *   <li>Un error de verdad —sin sede— si tiene que verse como error, y con su salida propia.</li>
 * </ol>
 */
describe('ArancelEfectivoPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArancelEfectivoPage],
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

  afterEach(() => {
    httpMock.verify();
  });

  it('cuando resuelve muestra el importe con sus dos partes y la derivacion', async () => {
    const fixture = await montar();
    await consultar(fixture, RESUELTO);

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('ARS 12000.00');
    // Las dos partes van siempre: lo que el mostrador necesita no es el total, es el coseguro.
    expect(texto).toContain('Pone el financiador');
    expect(texto).toContain('ARS 9000.00');
    expect(texto).toContain('Paga el paciente');
    expect(texto).toContain('ARS 3000.00');

    // Sin la derivacion, un importe inesperado no se puede explicar.
    expect(texto).toContain('De donde sale este precio');
    expect(texto).toContain('OSDE 210 kinesiologia');
    expect(texto).toContain('CONV-OSDE-210');
    expect(texto).toContain('inclusive');

    // Y los requisitos se declaran como lo que son: algo que verifica una persona.
    expect(texto).toContain('no los hace cumplir todavia');
  });

  it('SIN_CONVENIO_VIGENTE no es un error: manda a cobrar como particular', async () => {
    const fixture = await montar();
    await consultar(fixture, {
      resuelto: false,
      motivo: 'SIN_CONVENIO_VIGENTE',
      fecha: '2026-03-15',
    });

    const anfitrion = fixture.nativeElement as HTMLElement;
    // Ni un cartel de error ni un vacio: el servidor respondio 200 y esto es el desenlace mas
    // frecuente de todos.
    expect(anfitrion.querySelector('.estado--error')).toBeNull();
    expect(anfitrion.textContent).toContain('No hay convenio vigente');
    expect(anfitrion.textContent).toContain('se cobra como particular');
  });

  it('SIN_ARANCEL_VIGENTE dice otra cosa: hay convenio y falta el precio', async () => {
    // Aplanar los dos motivos deja al usuario sin saber si tiene que cobrar o cargar un dato.
    const fixture = await montar();
    await consultar(fixture, {
      resuelto: false,
      motivo: 'SIN_ARANCEL_VIGENTE',
      fecha: '2026-03-15',
    });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Hay convenio');
    expect(texto).toContain('Carga el arancel');
    expect(texto).not.toContain('se cobra como particular');
  });

  it('la fecha viaja como la de la PRESTACION y cambiarla cambia la consulta', async () => {
    const fixture = await montar();
    const peticion = await consultar(fixture, RESUELTO, '2025-11-20');
    expect(peticion.request.params.get('fecha')).toBe('2025-11-20');
    expect(peticion.request.params.get('financiadorId')).toBe('10');
    expect(peticion.request.params.get('planId')).toBe('100');
    expect(peticion.request.params.get('practicaId')).toBe('55');
  });

  it('cambiar de financiador limpia el plan elegido y pide los del nuevo', async () => {
    const fixture = await montar();

    elegir(fixture, '#consulta-financiador', '10');
    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.method === 'GET' && p.url === rutaPlanes(10))
      .flush([PLAN]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#consulta-plan', '100');
    expect(valorDe(fixture, '#consulta-plan')).toBe('100');

    // Sin el reset, la consulta sale con un plan de otro financiador y el usuario recibe "no hay
    // convenio" sobre una combinacion que nunca pidio.
    elegir(fixture, '#consulta-financiador', '10');
    expect(valorDe(fixture, '#consulta-plan')).toBe('');
    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.method === 'GET' && p.url === rutaPlanes(10))
      .flush([PLAN]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('un convenio sin requisitos ni fin de vigencia no inventa ninguno de los dos', async () => {
    // La rama opuesta a la del caso completo. Si el bloque de requisitos se dibujara siempre,
    // diria "requisitos declarados" sobre un convenio que no declara ninguno.
    const fixture = await montar();
    await consultar(fixture, {
      ...RESUELTO,
      requiereOrden: false,
      requiereCredencial: false,
      limiteSesionesMensual: undefined,
      convenioVigenciaHasta: undefined,
      arancelVigenciaHasta: undefined,
    });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).not.toContain('Requisitos declarados');
    expect(texto).toContain('sin fin previsto');
  });

  it('el formulario incompleto no consulta y senala los tres campos', async () => {
    const fixture = await montar();
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((p: HttpRequest<unknown>) => p.url === EFECTIVO);
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Eligi el financiador del paciente');
    expect(texto).toContain('El plan es obligatorio');
    expect(texto).toContain('Eligi que practica se presto');
  });

  it('un 403 si es un error, y se muestra como tal', async () => {
    // La distincion que sostiene toda la pantalla: `resuelto: false` es una respuesta, un 403 no.
    const fixture = await montar();

    elegir(fixture, '#consulta-financiador', '10');
    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.method === 'GET' && p.url === rutaPlanes(10))
      .flush([PLAN]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#consulta-plan', '100');
    elegir(fixture, '#consulta-practica', '55');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.url === EFECTIVO)
      .flush(
        { type: 'https://akine.app/problems/forbidden' },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.querySelector('.estado--error')).not.toBeNull();
    expect(anfitrion.textContent).toContain('hace falta administrar convenios');
  });

  it('dejar el financiador en vacio limpia el plan y no pide nada', async () => {
    const fixture = await montar();

    elegir(fixture, '#consulta-financiador', '10');
    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.method === 'GET' && p.url === rutaPlanes(10))
      .flush([PLAN]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#consulta-financiador', '');
    expect(valorDe(fixture, '#consulta-plan')).toBe('');
    // Sin financiador no hay a quien pedirle planes: una peticion aca seria a `/financiadores//planes`.
    httpMock.expectNone((p: HttpRequest<unknown>) => p.url.includes('/planes'));
  });

  it('sin sede elegida no consulta y manda a elegirla, no al login', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Centro Belgrano' });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(ArancelEfectivoPage);
    fixture.detectChanges();
    httpMock
      .match((p: HttpRequest<unknown>) => p.url === RUTA_FINANCIADORES)
      .forEach((p) => p.flush([OSDE]));
    httpMock
      .match((p: HttpRequest<unknown>) => p.url === RUTA_PRACTICAS)
      .forEach((p) => p.flush({ content: [PRACTICA] }));
    await fixture.whenStable();
    fixture.detectChanges();

    enviar(fixture, 'form[novalidate]');

    // La consulta empieza en `/consultorios/{cid}`: sin sede no se puede ni armar.
    httpMock.expectNone((p: HttpRequest<unknown>) => p.url.includes('/aranceles/efectivo'));
    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Eligi un consultorio');
    expect(anfitrion.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
    expect(anfitrion.textContent).not.toContain('Sesion expirada');
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await consultar(fixture, RESUELTO);
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  /** Completa el formulario, envia y devuelve la peticion ya respondida con `respuesta`. */
  async function consultar(
    fixture: ComponentFixture<ArancelEfectivoPage>,
    respuesta: Record<string, unknown>,
    fecha = '2026-03-15',
  ) {
    elegir(fixture, '#consulta-financiador', '10');
    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.method === 'GET' && p.url === rutaPlanes(10))
      .flush([PLAN]);
    await fixture.whenStable();
    fixture.detectChanges();

    elegir(fixture, '#consulta-plan', '100');
    elegir(fixture, '#consulta-practica', '55');
    escribir(fixture, '#consulta-fecha', fecha);
    enviar(fixture, 'form[novalidate]');

    const peticion = httpMock.expectOne(
      (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === EFECTIVO,
    );
    peticion.flush(respuesta);
    await fixture.whenStable();
    fixture.detectChanges();
    return peticion;
  }

  async function montar(): Promise<ComponentFixture<ArancelEfectivoPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(ArancelEfectivoPage);
    fixture.detectChanges();

    httpMock.expectOne((p: HttpRequest<unknown>) => p.url === RUTA_FINANCIADORES).flush([OSDE]);
    httpMock
      .expectOne((p: HttpRequest<unknown>) => p.url === RUTA_PRACTICAS)
      .flush({ content: [PRACTICA] });
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }
});

function elegir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement | null;
  if (campo === null) {
    throw new Error(`No existe el selector ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function valorDe(fixture: { nativeElement: HTMLElement }, selector: string): string {
  return fixture.nativeElement.querySelector<HTMLSelectElement>(selector)?.value ?? '';
}

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = fixture.nativeElement.querySelector<HTMLFormElement>(selector);
  if (formulario === null) {
    throw new Error(`No existe el formulario ${selector}`);
  }
  formulario.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
