import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { VigenciasPage } from './vigencias-page';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const NOMENCLADOR_PROPIO = {
  id: 5,
  organizationId: 1,
  tipo: 'NOMENCLADOR',
  alcance: 'ORGANIZACION',
  codigo: 'INT',
  name: 'Nomenclador interno',
  estado: 'ACTIVO',
  vigente: true,
  version: 1,
};

/** El mismo, pero de la plataforma: sin `organizationId`, que es lo que ADR-0021 usa. */
const SIN_ORGANIZACION: Record<string, unknown> = { ...NOMENCLADOR_PROPIO };
delete SIN_ORGANIZACION['organizationId'];
const NOMENCLADOR_GLOBAL = { ...SIN_ORGANIZACION, alcance: 'GLOBAL' };

/** Vigencia que rige hoy: la unica que ofrece la baja. */
const VIGENTE = {
  id: 40,
  tipo: 'NOMENCLADOR',
  alcance: 'ORGANIZACION',
  nomencladorId: 5,
  practicaId: 9,
  codigo: '250101',
  name: 'Sesion de kinesiologia',
  valorReferencia: 4500,
  validFrom: '2026-01-01T00:00:00Z',
  estado: 'ACTIVO',
  vigente: true,
  version: 1,
};

/** La misma practica, con el codigo viejo, ya cerrada: es lo que RN-M06-002 protege. */
const CERRADA = {
  ...VIGENTE,
  id: 39,
  codigo: '240101',
  valorReferencia: 3000,
  validUntil: '2025-12-31T00:00:00Z',
  estado: 'INACTIVO',
  vigente: false,
  deactivationReason: 'Cambio de nomenclador 2026',
};

const PRACTICAS = {
  content: [
    {
      id: 9,
      tipo: 'PRACTICA',
      alcance: 'GLOBAL',
      codigo: 'KIN-SES',
      name: 'Sesion de kinesiologia',
      estado: 'ACTIVO',
      vigente: true,
      version: 1,
    },
  ],
  page: 0,
  size: 100,
  totalElements: 1,
  totalPages: 1,
};

const NOMENCLADOR = '/api/v1/catalogos/nomencladores/5';
const VIGENCIAS = `${NOMENCLADOR}/items`;

/**
 * Spec de las vigencias de un nomenclador (M06, AKINE-02.05).
 *
 * <p>Cubre las dos cosas que la etapa no puede permitirse perder:
 *
 * <ol>
 *   <li>Que <b>no exista edicion</b>. Una vigencia editable es la forma de reescribir el
 *       significado de presentaciones que ya se hicieron (RN-M06-002), y el sintoma de que
 *       aparezca un "Editar" no seria un error: seria un numero distinto en un reporte viejo.</li>
 *   <li>Que un nomenclador de la plataforma se pueda <b>consultar</b> y no administrar.</li>
 * </ol>
 */
describe('VigenciasPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VigenciasPage],
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

  it('no hay ninguna forma de editar una vigencia, y la pantalla explica por que', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    const acciones = [...anfitrion.querySelectorAll('tbody button')].map((boton) =>
      (boton.textContent ?? '').trim(),
    );
    // Solo la vigencia ACTIVA ofrece baja. Ninguna ofrece edicion, y no es que este escondida.
    expect(acciones).toEqual(['Dar de baja']);
    expect(anfitrion.textContent).not.toContain('Editar');
    expect(anfitrion.textContent).toContain('se cierra y se abre otra');

    // La cerrada sigue en el listado con su codigo y su valor viejos: eso es lo que hace que
    // una presentacion de 2025 siga resolviendo.
    expect(anfitrion.textContent).toContain('240101');
    expect(anfitrion.textContent).toContain('3000');
  });

  it('la baja manda el motivo y avisa que no corrige nada', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    const baja = [...anfitrion.querySelectorAll('button')].find(
      (boton) => (boton.textContent ?? '').trim() === 'Dar de baja',
    );
    baja?.click();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('conserva su codigo y su valor');

    const motivo = anfitrion.querySelector<HTMLInputElement>('#baja-vigencia-motivo');
    if (motivo === null) {
      throw new Error('No existe el campo de motivo');
    }
    motivo.value = 'Cambio de nomenclador 2027';
    motivo.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const confirmar = [...anfitrion.querySelectorAll('button')].find(
      (boton) => (boton.textContent ?? '').trim() === 'Dar de baja' && boton.type === 'submit',
    );
    confirmar?.click();
    fixture.detectChanges();

    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) =>
        candidata.method === 'POST' && candidata.url === `${VIGENCIAS}/40/deactivate`,
    );
    expect(peticion.request.body).toEqual({ reason: 'Cambio de nomenclador 2027' });
    peticion.flush({ ...VIGENTE, estado: 'INACTIVO' });

    httpMock.expectOne(NOMENCLADOR).flush(NOMENCLADOR_PROPIO);
    httpMock.expectOne(esListado()).flush([CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('conserva el codigo y el valor que tenia');
  });

  it('un nomenclador de la plataforma se consulta pero no se administra', async () => {
    const fixture = await montar(NOMENCLADOR_GLOBAL);
    const anfitrion = fixture.nativeElement as HTMLElement;

    // Las vigencias se ven -es el catalogo comun, y consultarlo es lo que todos necesitan-.
    expect(anfitrion.textContent).toContain('250101');
    // Pero no hay ni alta ni baja: el backend responde 403 y ofrecerlo seria ofrecer un error.
    expect(anfitrion.textContent).toContain('lo mantiene AKINE');
    expect(anfitrion.querySelectorAll('button').length).toBe(0);
    expect(anfitrion.querySelector('a[href="/catalogo/solicitudes"]')).not.toBeNull();
  });

  it('el alta exige codigo, nombre y practica, y omite lo opcional que quedo vacio', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    pulsar(anfitrion, fixture, 'Cargar una vigencia');

    // Sin completar nada no sale ninguna peticion y se nombran los tres obligatorios.
    anfitrion.querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    httpMock.expectNone(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === VIGENCIAS,
    );
    expect(anfitrion.textContent).toContain('El codigo es obligatorio');

    escribir(anfitrion, '#alta-vigencia-codigo', '260101');
    escribir(anfitrion, '#alta-vigencia-name', 'Sesion de kinesiologia 2027');
    elegir(anfitrion, '#alta-vigencia-practica', '9');
    escribir(anfitrion, '#alta-vigencia-valor', '5200');
    fixture.detectChanges();

    anfitrion.querySelector('form')?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === VIGENCIAS,
    );
    // La descripcion y las dos fechas quedaron vacias: no viajan. `practicaId` viaja como
    // numero aunque el `select` entregue texto.
    expect(alta.request.body).toEqual({
      codigo: '260101',
      name: 'Sesion de kinesiologia 2027',
      practicaId: 9,
      valorReferencia: 5200,
    });

    alta.flush({ ...VIGENTE, id: 41, codigo: '260101' });
    httpMock.expectOne(NOMENCLADOR).flush(NOMENCLADOR_PROPIO);
    httpMock.expectOne(esListado()).flush([VIGENTE, CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('Las anteriores del mismo codigo no se tocaron');
  });

  it('el filtro por codigo es lo que muestra la historia completa de un codigo', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    const campo = anfitrion.querySelector<HTMLInputElement>('#filtro-codigo-vigencia');
    if (campo === null) {
      throw new Error('No existe el filtro por codigo');
    }
    campo.value = '240101';
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    httpMock.expectOne(NOMENCLADOR).flush(NOMENCLADOR_PROPIO);
    const filtrada = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === VIGENCIAS && peticion.params.get('codigo') === '240101',
    );
    filtrada.flush([CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('un id que no es un numero no le pide nada al backend', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(VigenciasPage);
    fixture.componentRef.setInput('nomencladorId', 'cualquiera');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url.includes('/catalogos/'));
    httpMock
      .match(RUTA_PERMISOS_EFECTIVOS)
      .forEach((peticion) => peticion.flush({ permissions: [] }));

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('no apunta a ningun nomenclador');
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  async function montar(
    nomenclador: Record<string, unknown> = NOMENCLADOR_PROPIO,
  ): Promise<ComponentFixture<VigenciasPage>> {
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

    const fixture = TestBed.createComponent(VigenciasPage);
    fixture.componentRef.setInput('nomencladorId', '5');
    fixture.detectChanges();

    httpMock.expectOne(NOMENCLADOR).flush(nomenclador);
    httpMock
      .expectOne('/api/v1/catalogos/practicas?estado=ACTIVO&alcance=TODOS&page=0&size=100')
      .flush(PRACTICAS);
    httpMock.expectOne(esListado()).flush([VIGENTE, CERRADA]);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === VIGENCIAS;
  }
});

function pulsar(
  anfitrion: HTMLElement,
  fixture: { detectChanges(): void },
  etiqueta: string,
): void {
  const boton = [...anfitrion.querySelectorAll('button')].find((candidato) =>
    (candidato.textContent ?? '').trim().startsWith(etiqueta),
  );
  if (boton === undefined) {
    throw new Error(`No existe el boton ${etiqueta}`);
  }
  boton.click();
  fixture.detectChanges();
}

function escribir(anfitrion: HTMLElement, selector: string, valor: string): void {
  const campo = anfitrion.querySelector(selector) as HTMLInputElement | null;
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
}

function elegir(anfitrion: HTMLElement, selector: string, valor: string): void {
  const campo = anfitrion.querySelector(selector) as HTMLSelectElement | null;
  if (campo === null) {
    throw new Error(`No existe el selector ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
}
