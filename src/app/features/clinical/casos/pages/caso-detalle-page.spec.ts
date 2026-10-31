import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CasoDetallePage } from './caso-detalle-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { VisitaClinica } from '../../services/visita-clinica';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';

const CASO = '/api/v1/casos-clinicos/9';
const HEADER = 'X-Justificacion-Acceso';

const caso = (version: number, rol = 'RESPONSABLE') => ({
  id: 9,
  numeroCaso: 1,
  estado: 'ACTIVO',
  ofertaId: 14,
  ofertaConsultorioId: 3,
  ofertaNombre: 'Kinesiologia',
  diagnosticoPresuntivo: 'Lumbalgia',
  abiertoEn: '2026-10-01T12:00:00Z',
  equipo: [
    { id: 1, profesionalMembershipId: 31, profesionalNombre: 'Lopez, Maria', rol, vigente: true },
  ],
  version,
});

/**
 * El caso clinico (D-b). Lo que no se ve en el E2E feliz: que cada escritura mande la version que
 * devolvio la anterior —dos cambios de equipo seguidos, el defecto de api #109—, y que un enlace
 * directo sin relacion asistencial pida el motivo y despues lo mande.
 */
describe('CasoDetallePage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CasoDetallePage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        VisitaClinica,
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    TestBed.inject(VisitaClinica).iniciar(12);
  });

  afterEach(() => {
    // "Nuevo turno" lo ofrece una directiva de permisos, que los pide al dibujarse.
    httpMock.match(RUTA_PERMISOS_EFECTIVOS).forEach((r) => r.flush({ permissions: [] }));
    httpMock.verify();
  });

  it('sin relación pide el motivo y lo manda en la relectura', async () => {
    const fixture = await montar();
    // forkJoin cancela el otro pedido cuando el primero falla: solo se contesta el vivo.
    for (const pedido of httpMock.match((r) => r.url.startsWith(CASO))) {
      if (pedido.cancelled) continue;
      pedido.flush(
        { type: 'https://akine.app/problems/forbidden', status: 403, requiereJustificacion: true },
        { status: 403, statusText: 'F' },
      );
    }
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Declara el motivo del acceso');

    TestBed.inject(VisitaClinica).declarar('Interconsulta');
    await estabilizar(fixture);
    const pedidos = httpMock.match((r) => r.url.startsWith(CASO));
    expect(pedidos.length).toBe(2);
    for (const pedido of pedidos) {
      expect(pedido.request.headers.get(HEADER)).toBe('Interconsulta');
    }
    pedidos.find((p) => p.request.url === CASO)?.flush(caso(3));
    pedidos.find((p) => p.request.url.endsWith('/eventos'))?.flush([]);
    await estabilizar(fixture);
    responderSede();
    expect(texto(fixture)).toContain('Lumbalgia');
  });

  it('dos cambios de equipo seguidos mandan cada uno la versión que devolvio el anterior', async () => {
    const fixture = await cargado();

    elegirRol(fixture, 'TRATANTE');
    clic(fixture, 'Guardar el equipo');
    const primero = httpMock.expectOne(`${CASO}/equipo`);
    expect(primero.request.body).toEqual({
      integrantes: [{ profesionalMembershipId: 31, rol: 'TRATANTE' }],
      expectedVersion: 3,
    });
    primero.flush(caso(4, 'TRATANTE'));
    httpMock.expectOne(`${CASO}/eventos`).flush([]);
    await estabilizar(fixture);

    elegirRol(fixture, 'RESPONSABLE');
    clic(fixture, 'Guardar el equipo');
    const segundo = httpMock.expectOne(`${CASO}/equipo`);
    expect(segundo.request.body.expectedVersion).toBe(4);
    segundo.flush(caso(5));
    httpMock.expectOne(`${CASO}/eventos`).flush([]);
    await estabilizar(fixture);
    // UX-12: cada resultado es un aviso global.
    expect(
      TestBed.inject(AvisosStore)
        .avisos()
        .map((aviso) => aviso.titulo),
    ).toEqual(['Equipo del caso guardado', 'Equipo del caso guardado']);
  });

  it('la oferta y el equipo se nombran con lo que trae el caso, sin pedir el listado de ofertas', async () => {
    const fixture = await cargado();
    expect(texto(fixture)).toContain('Caso 1 · Kinesiologia');
    // El integrante guardado ya no esta habilitado: igual se lo ve por su nombre.
    expect(texto(fixture)).toContain('Lopez, Maria');
    httpMock.expectNone((r) => r.url === '/api/v1/consultorios/3/ofertas');
  });

  it('una versión vieja ofrece releer en vez de pisar', async () => {
    const fixture = await cargado();
    escribir(fixture, '#caso-motivo', 'Alta');
    clic(fixture, 'Cerrar el caso');
    httpMock
      .expectOne(`${CASO}/cierre`)
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'C' },
      );
    await estabilizar(fixture);
    // Advertencia ARRIBA del formulario que mando el cierre, con la salida.
    const alerta = (fixture.nativeElement as HTMLElement).querySelector('form app-alerta');
    expect(alerta?.textContent).toContain('No pudimos cerrar el caso');
    expect(alerta?.textContent).toContain('Alguien cambio este caso');
    expect(botones(fixture)).toContain('Releer el caso');
  });

  it('"Nuevo turno" abre el flujo con la persona, el caso y la oferta de esta sede', async () => {
    const fixture = await cargado();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_TURNO_MANAGE] });
    await estabilizar(fixture);

    clic(fixture, 'Nuevo turno');

    expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
      tipo: 'nuevo',
      contexto: { origen: 'CASO', personaId: 12, casoId: 9, ofertaId: 14 },
    });
  });

  it('la oferta de otra sede no viaja: el caso es de la organización y la oferta, de una sede', async () => {
    const fixture = await cargado({ ...caso(3), ofertaConsultorioId: 99 });
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_TURNO_MANAGE] });
    await estabilizar(fixture);

    clic(fixture, 'Nuevo turno');

    expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
      tipo: 'nuevo',
      contexto: { origen: 'CASO', personaId: 12, casoId: 9, ofertaId: undefined },
    });
  });

  it('un caso cerrado no ofrece dar turnos', async () => {
    const fixture = await cargado({ ...caso(3), estado: 'CERRADO' });

    httpMock.expectNone(RUTA_PERMISOS_EFECTIVOS);
    expect(botones(fixture)).not.toContain('Nuevo turno');
  });

  it(
    'cargado no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await cargado();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(): Promise<ComponentFixture<CasoDetallePage>> {
    const fixture = TestBed.createComponent(CasoDetallePage);
    fixture.componentRef.setInput('casoId', '9');
    await estabilizar(fixture);
    return fixture;
  }

  async function cargado(leido: object = caso(3)): Promise<ComponentFixture<CasoDetallePage>> {
    const fixture = await montar();
    httpMock.expectOne(CASO).flush(leido);
    httpMock
      .expectOne(`${CASO}/eventos`)
      .flush([{ id: 1, tipo: 'APERTURA', ocurrioEn: '2026-10-01T12:00:00Z' }]);
    await estabilizar(fixture);
    responderSede();
    await estabilizar(fixture);
    return fixture;
  }

  function responderSede(): void {
    httpMock
      .match((r) => r.url === '/api/v1/consultorios/3/ofertas/14/habilitaciones')
      .forEach((r) => r.flush({ profesionales: [{ membershipId: 40, nombre: 'Perez, Ana' }] }));
  }

  async function estabilizar(fixture: ComponentFixture<CasoDetallePage>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<CasoDetallePage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function botones(fixture: ComponentFixture<CasoDetallePage>): string[] {
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).map(
      (b) => b.textContent?.trim() ?? '',
    );
  }

  function clic(fixture: ComponentFixture<CasoDetallePage>, rotulo: string): void {
    const boton = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === rotulo);
    if (!boton) throw new Error(`No hay botón "${rotulo}"`);
    boton.click();
    fixture.detectChanges();
  }

  function elegirRol(fixture: ComponentFixture<CasoDetallePage>, rol: string): void {
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      'select[aria-label^="Rol de"]',
    ) as HTMLSelectElement;
    select.value = rol;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<CasoDetallePage>,
    selector: string,
    valor: string,
  ): void {
    const campo = (fixture.nativeElement as HTMLElement).querySelector(
      selector,
    ) as HTMLTextAreaElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
});
