import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { EnmiendaPage } from './enmienda-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { PERMISO_SESION_AMEND, PERMISO_SESION_REGISTER } from '../../../../core/models/permisos';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const CONSULTORIO = 3;
const SESION = 501;
const VER = `/api/v1/consultorios/${CONSULTORIO}/sesiones/${SESION}`;
const VERSIONES = `${VER}/versiones`;
const ENMIENDAS = `${VER}/enmiendas`;

const CERRADA = {
  id: SESION,
  turnoId: 77,
  numeroSesion: 8,
  version: 12,
  cerradaEn: '2026-09-15T12:48:00Z',
  cierre: { asistencia: 'PRESENTE' },
  ultimoNumeroVersion: 2,
};

const V1 = { numeroVersion: 1, notaDeCierre: 'Original.', registradaEn: '2026-09-15T12:48:00Z' };
const V2 = {
  numeroVersion: 2,
  registradaEn: '2026-09-16T10:00:00Z',
  motivoEnmienda: 'Faltaba la zona',
  dolorEva: 6,
  dolorZona: 'rodilla',
  dolorLateralidad: 'DERECHA',
  evolucion: 'MEJOR',
  notaDeCierre: 'Movilidad pasiva y activa.',
  tolerancia: 'BUENA',
  proximaConducta: 'CONTINUA',
  tratamientos: [
    {
      tratamientoId: 900,
      orden: 1,
      practicaId: 70,
      practicaNombre: 'Electroterapia',
      espacioId: 30,
      zona: 'rodilla',
      lateralidad: 'DERECHA',
      duracionMinutos: 15,
      parametros: [
        { clave: 'Intensidad', tipoDato: 'NUMERICO', valorNumerico: 20, unidad: 'mA' },
        { clave: 'Supervisado', tipoDato: 'BOOLEANO', valorBooleano: true },
      ],
    },
  ],
  mediciones: [
    {
      definicionId: 11,
      lateralidad: 'DERECHA',
      nombre: 'Flexion de rodilla',
      tipo: 'NUMERICO',
      unidad: 'grados',
      valorNumerico: 100,
    },
    {
      definicionId: 12,
      lateralidad: 'NO_APLICA',
      nombre: 'Edema',
      tipo: 'BOOLEANO',
      valorBooleano: false,
    },
  ],
};

/**
 * Spec de la enmienda (AKINE-06.06, C-6).
 *
 * <p>Lo que decide comportamiento: <b>el motivo es obligatorio</b>, el formulario parte de la
 * ULTIMA version y se manda entero (reemplazo completo), tratamientos y mediciones solo viajan si
 * se tocaron, y un 409 de version ofrece releer conservando el motivo.
 */
describe('EnmiendaPage', () => {
  let httpMock: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EnmiendaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => httpMock.verify());

  it('precarga la ULTIMA versión, no la primera', async () => {
    const fixture = await montar();

    expect(valor(fixture, '#enmienda-nota')).toBe('Movilidad pasiva y activa.');
    expect(valor(fixture, '#enmienda-zona')).toBe('rodilla');
    expect(valor(fixture, '#enmienda-dolor')).toBe('6');
    expect(texto(fixture)).toContain('Partís de la versión 2');
  });

  it('sin motivo no manda nada y dice por que', async () => {
    const fixture = await montar();
    apretar(fixture, 'Registrar la enmienda');
    expect(texto(fixture)).toContain('Falta el motivo');
    httpMock.expectNone((p) => p.method === 'POST');
  });

  it('con el paciente presente no deja vaciar la nota de cierre', async () => {
    const fixture = await montar();
    escribir(fixture, '#enmienda-motivo', 'Corrijo la nota');
    escribir(fixture, '#enmienda-nota', '   ');
    apretar(fixture, 'Registrar la enmienda');
    expect(texto(fixture)).toContain('la nota de cierre no puede quedar vacía');
    httpMock.expectNone((p) => p.method === 'POST');
  });

  it('manda el formulario entero, SIN tratamientos ni mediciones si no se tocaron', async () => {
    const fixture = await montar();
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    escribir(fixture, '#enmienda-motivo', '  Faltaba la indicacion  ');
    escribir(fixture, '#enmienda-indicaciones', 'Hielo 20 minutos');
    apretar(fixture, 'Registrar la enmienda');

    const pedido = httpMock.expectOne((p) => p.method === 'POST' && p.url === ENMIENDAS);
    expect(pedido.request.body).toEqual({
      version: 12,
      motivo: 'Faltaba la indicacion',
      dolorEva: 6,
      dolorZona: 'rodilla',
      dolorLateralidad: 'DERECHA',
      evolucion: 'MEJOR',
      notaDeCierre: 'Movilidad pasiva y activa.',
      tolerancia: 'BUENA',
      indicaciones: 'Hielo 20 minutos',
      proximaConducta: 'CONTINUA',
    });
    pedido.flush({ ...CERRADA, version: 13 });
    await estabilizar(fixture);

    expect(navegar).toHaveBeenCalledWith(['/atencion', 'sesiones', SESION, 'versiones']);
  });

  it('al tocar un tratamiento manda la lista entera, con su id, práctica y parametros', async () => {
    const fixture = await montar();
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    escribir(fixture, '#enmienda-motivo', 'La intensidad era otra');
    escribir(fixture, '#enmienda-param-0-0', '25');
    apretar(fixture, 'Registrar la enmienda');

    const pedido = httpMock.expectOne((p) => p.method === 'POST');
    const cuerpo = pedido.request.body as { tratamientos: unknown[]; mediciones?: unknown[] };
    expect(cuerpo.mediciones).toBeUndefined();
    expect(cuerpo.tratamientos).toEqual([
      {
        tratamientoId: 900,
        practicaId: 70,
        espacioId: 30,
        zona: 'rodilla',
        lateralidad: 'DERECHA',
        duracionMinutos: 15,
        parametros: [
          { clave: 'Intensidad', tipoDato: 'NUMERICO', valorNumerico: 25, unidad: 'mA' },
          { clave: 'Supervisado', tipoDato: 'BOOLEANO', valorBooleano: true },
        ],
      },
    ]);
    pedido.flush(CERRADA);
  });

  it('quitar un tratamiento lo saca de la lista: lo que no aparece se da de baja', async () => {
    const fixture = await montar();
    escribir(fixture, '#enmienda-motivo', 'No se hizo');
    marcar(fixture, 'Quitar Electroterapia de la sesión');
    apretar(fixture, 'Registrar la enmienda');

    const pedido = httpMock.expectOne((p) => p.method === 'POST');
    expect((pedido.request.body as { tratamientos: unknown[] }).tratamientos).toEqual([]);
    pedido.flush(
      {
        type: 'https://akine.app/problems/enmienda-cambia-practicas',
        status: 409,
        detail: 'Cambia prácticas.',
      },
      { status: 409, statusText: 'Conflict' },
    );
  });

  it('enmienda-cambia-practicas explica que la práctica no se corrige enmendando', async () => {
    const fixture = await montar();
    escribir(fixture, '#enmienda-motivo', 'No se hizo');
    marcar(fixture, 'Quitar Electroterapia de la sesión');
    apretar(fixture, 'Registrar la enmienda');
    httpMock
      .expectOne((p) => p.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/enmienda-cambia-practicas',
          status: 409,
          detail: 'Cambia prácticas.',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('no se corrige enmendando');
  });

  it('al tocar una medición manda las mediciones, con el lado y el valor del tipo', async () => {
    const fixture = await montar();
    escribir(fixture, '#enmienda-motivo', 'Error de tipeo en el ROM');
    escribir(fixture, '#enmienda-medicion-0', '110');
    apretar(fixture, 'Registrar la enmienda');

    const pedido = httpMock.expectOne((p) => p.method === 'POST');
    const cuerpo = pedido.request.body as { tratamientos?: unknown[]; mediciones: unknown[] };
    expect(cuerpo.tratamientos).toBeUndefined();
    expect(cuerpo.mediciones).toEqual([
      { definicionId: 11, lateralidad: 'DERECHA', valorNumerico: 110 },
      { definicionId: 12, lateralidad: 'NO_APLICA', valorBooleano: false },
    ]);
    pedido.flush(
      { type: 'https://akine.app/problems/sesion-ajena', status: 409 },
      { status: 409, statusText: 'Conflict' },
    );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('otro profesional');
  });

  it('un 409 de versión ofrece releer, y al releer conserva el motivo', async () => {
    const fixture = await montar();
    escribir(fixture, '#enmienda-motivo', 'Mi motivo');
    escribir(fixture, '#enmienda-zona', 'tobillo');
    apretar(fixture, 'Registrar la enmienda');
    httpMock
      .expectOne((p) => p.method === 'POST')
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Alguien enmendó esta atención');

    apretar(fixture, 'Releer la última versión');
    responder({ ...CERRADA, version: 13 }, [
      V1,
      V2,
      { ...V2, numeroVersion: 3, dolorZona: 'cadera' },
    ]);
    await estabilizar(fixture);

    expect(valor(fixture, '#enmienda-motivo')).toBe('Mi motivo');
    expect(valor(fixture, '#enmienda-zona')).toBe('cadera');
  });

  it('muestra hasta cuando se puede enmendar (DP-43)', async () => {
    const fixture = await montar({ ...CERRADA, enmendableHasta: '2099-10-15T12:48:00Z' });
    expect(texto(fixture)).toContain('Se puede enmendar hasta');
    expect(botonEnmendar(fixture).disabled).toBe(false);
  });

  it('una ventana vencida no deja mandar la enmienda', async () => {
    const fixture = await montar({ ...CERRADA, enmendableHasta: '2026-01-01T00:00:00Z' });
    expect(texto(fixture)).toContain('La ventana para enmendar esta atención cerró');
    expect(botonEnmendar(fixture).disabled).toBe(true);
  });

  it('el 409 enmienda-fuera-de-ventana dice hasta cuando se podia y bloquea el envio', async () => {
    const fixture = await montar();
    escribir(fixture, '#enmienda-motivo', 'Corrijo la zona');
    apretar(fixture, 'Registrar la enmienda');
    httpMock
      .expectOne((p) => p.method === 'POST' && p.url === ENMIENDAS)
      .flush(
        {
          type: 'https://akine.app/problems/enmienda-fuera-de-ventana',
          status: 409,
          cerradaEn: '2026-09-15T12:48:00Z',
          ventanaDias: 30,
          enmendableHasta: '2026-10-15T12:48:00Z',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('ya no se puede enmendar');
    expect(texto(fixture)).toContain('durante 30 días');
    expect(botonEnmendar(fixture).disabled).toBe(true);
  });

  it('sin sesión:amend lo dice y no deja mandar', async () => {
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_SESION_REGISTER] });
    const fixture = await montar();
    expect(texto(fixture)).toContain('necesita el permiso de enmienda');
    expect(botonEnmendar(fixture).disabled).toBe(true);
  });

  it('con sesión:amend deja mandar', async () => {
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_SESION_AMEND] });
    const fixture = await montar();
    expect(texto(fixture)).not.toContain('necesita el permiso de enmienda');
    expect(botonEnmendar(fixture).disabled).toBe(false);
  });

  it('una atención abierta no se enmienda: lo dice', async () => {
    const fixture = await montar({ ...CERRADA, numeroSesion: undefined }, []);
    expect(texto(fixture)).toContain('Esta atención sigue abierta');
    expect(fixture.nativeElement.querySelector('#enmienda-motivo')).toBeNull();
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------

  async function montar(
    sesion: object = CERRADA,
    versiones: object[] = [V1, V2],
  ): Promise<ComponentFixture<EnmiendaPage>> {
    const fixture = TestBed.createComponent(EnmiendaPage);
    fixture.componentRef.setInput('sesionId', String(SESION));
    fixture.detectChanges();
    responder(sesion, versiones);
    await estabilizar(fixture);
    return fixture;
  }

  function responder(sesion: object, versiones: object[]): void {
    httpMock.expectOne((p) => p.method === 'GET' && p.url === VER).flush(sesion);
    httpMock.expectOne((p) => p.method === 'GET' && p.url === VERSIONES).flush(versiones);
  }

  async function estabilizar(fixture: ComponentFixture<EnmiendaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function valor(fixture: ComponentFixture<EnmiendaPage>, selector: string): string {
    return (fixture.nativeElement.querySelector(selector) as HTMLInputElement).value;
  }

  function escribir(fixture: ComponentFixture<EnmiendaPage>, selector: string, texto: string) {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = texto;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function marcar(fixture: ComponentFixture<EnmiendaPage>, rotulo: string): void {
    const label = Array.from(
      fixture.nativeElement.querySelectorAll('label') as NodeListOf<HTMLLabelElement>,
    ).find((l) => (l.textContent ?? '').trim().startsWith(rotulo));
    const caja = label?.querySelector('input') as HTMLInputElement;
    caja.checked = true;
    caja.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<EnmiendaPage>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim().startsWith(rotulo));
    if (boton === undefined) {
      throw new Error(`No hay ningún botón rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function botonEnmendar(fixture: ComponentFixture<EnmiendaPage>): HTMLButtonElement {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === 'Registrar la enmienda') as HTMLButtonElement;
  }

  function texto(fixture: ComponentFixture<EnmiendaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
