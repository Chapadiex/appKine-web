import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HabilitacionesDeLaOfertaPage } from './habilitaciones-de-la-oferta-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const ORG = 1;
const SEDE = 3;
const OFERTA = 34;

const HABILITACIONES = `/api/v1/consultorios/${SEDE}/ofertas/${OFERTA}/habilitaciones`;
const OFERTAS = `/api/v1/consultorios/${SEDE}/ofertas`;
const MEMBERSHIPS = `/api/v1/organizations/${ORG}/memberships`;
const ESPACIOS = `/api/v1/organizations/${ORG}/consultorios/${SEDE}/espacios`;

const OFERTA_CARGADA = {
  id: OFERTA,
  nombreComercial: 'Kinesiologia deportiva',
  estado: 'ACTIVO',
  version: 4,
};

/** Sin ninguna habilitacion. NO significa "nadie": significa "cualquiera". */
const SIN_RESTRINGIR = {
  ofertaId: OFERTA,
  capacidadComercial: 8,
  capacidadEfectiva: 8,
  restringidaPorProfesional: false,
  restringidaPorEspacio: false,
  profesionales: [],
  espacios: [],
};

/**
 * Spec de las habilitaciones de una oferta (M27/M04/M05, AKINE-02.07).
 *
 * <p>Cubre los casos cuyo sintoma, cuando estan mal, <b>no es un error visible</b>:
 *
 * <ol>
 *   <li><b>Lista vacia significa TODOS.</b> Si la pantalla deja que se lea al reves, quien
 *       desmarca la ultima casilla creyendo que restringe termina abriendo la oferta a todo el
 *       centro, y nada en pantalla se lo dice.</li>
 *   <li><b>El guardado manda el conjunto completo con la version de la OFERTA, y vuelve a pedir
 *       la oferta.</b> Guardar hace avanzar esa version del lado del servidor y la respuesta no la
 *       trae: sin el repedido, guardar profesionales y despues espacios da un 409 que le echa la
 *       culpa a una edicion ajena que no existio.</li>
 *   <li><b>Una habilitacion cuyo vinculo se cayo se muestra, no se esconde.</b> Esconderla deja al
 *       administrador sin entender por que la capacidad efectiva cambio sola.</li>
 * </ol>
 */
describe('HabilitacionesDeLaOfertaPage', () => {
  let httpMock: HttpTestingController;
  let contexto: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HabilitacionesDeLaOfertaPage],
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
    contexto = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('sin ninguna casilla marcada dice que la oferta queda SIN RESTRINGIR, no sin nadie', async () => {
    const fixture = await montar();
    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(texto).toContain('la oferta queda sin restringir');
    expect(texto).toContain('cualquier profesional con vinculo vigente');
    // La lectura opuesta es la que rompe la agenda, y por eso se niega explicitamente.
    expect(texto).toContain('NO significa que no pueda ninguno');
  });

  it('guardar manda el conjunto completo con la version de la oferta y vuelve a pedirla', async () => {
    const fixture = await montar();

    marcar(fixture, 0);
    botonPorTexto(fixture, 'Guardar los profesionales')?.click();
    fixture.detectChanges();

    const guardado = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${HABILITACIONES}/profesionales`,
    );
    const cuerpo = guardado.request.body as { ids: number[]; expectedVersion: number };
    expect(cuerpo.ids).toEqual([77]);
    // La version es la de la OFERTA, no la de ninguna habilitacion.
    expect(cuerpo.expectedVersion).toBe(4);

    guardado.flush({ ...SIN_RESTRINGIR, restringidaPorProfesional: true });
    await fixture.whenStable();
    fixture.detectChanges();

    // El repedido de la oferta: guardar movio su version y la respuesta no la trae.
    httpMock.expectOne(esListadoDeOfertas()).flush([{ ...OFERTA_CARGADA, version: 5 }]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Guardamos la configuracion',
    );
  });

  it('una habilitacion cuyo vinculo ya no esta vigente se muestra con su advertencia', async () => {
    const fixture = await montar({
      ...SIN_RESTRINGIR,
      restringidaPorProfesional: true,
      profesionales: [
        {
          membershipId: 77,
          nombre: 'Ana Gomez',
          roleCode: 'PROFESIONAL',
          estado: 'ACTIVO',
          vinculoVigente: false,
        },
      ],
    });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Ana Gomez');
    expect(texto).toContain('Su vinculo con el centro ya no esta vigente');
  });

  it('la capacidad real se explica nombrando el espacio que la limita', async () => {
    // Un numero mas chico sin decir quien lo acota es un defecto: el administrador cargo 8 y ve
    // 6, y no tiene forma de saber por que.
    const fixture = await montar({
      ...SIN_RESTRINGIR,
      capacidadEfectiva: 6,
      espacioQueLimita: 'Sala chica',
      restringidaPorEspacio: true,
      espacios: [
        { espacioId: 10, nombre: 'Sala chica', capacidad: 6, estado: 'ACTIVO', enServicio: true },
      ],
    });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Sala chica');
    expect(texto).toContain('admite menos gente que la oferta');
  });

  it('un espacio fuera de servicio se muestra con su advertencia', async () => {
    const fixture = await montar({
      ...SIN_RESTRINGIR,
      restringidaPorEspacio: true,
      espacios: [
        { espacioId: 10, nombre: 'Pileta', capacidad: 6, estado: 'ACTIVO', enServicio: false },
      ],
    });

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Este espacio no esta en servicio',
    );
  });

  it('guardar los espacios manda su propio conjunto completo', async () => {
    const fixture = await montar();

    const casillas = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    // La segunda lista: la primera casilla es del profesional y la segunda, del espacio.
    casillas[1].click();
    fixture.detectChanges();

    botonPorTexto(fixture, 'Guardar los espacios')?.click();
    fixture.detectChanges();

    const guardado = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${HABILITACIONES}/espacios`,
    );
    expect((guardado.request.body as { ids: number[] }).ids).toEqual([10]);

    guardado.flush({ ...SIN_RESTRINGIR, restringidaPorEspacio: true });
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne(esListadoDeOfertas()).flush([OFERTA_CARGADA]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('un 409 de concurrencia no pisa nada y relee la configuracion', async () => {
    const fixture = await montar();

    marcar(fixture, 0);
    botonPorTexto(fixture, 'Guardar los profesionales')?.click();
    fixture.detectChanges();

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${HABILITACIONES}/profesionales`,
      )
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', title: 'Conflicto' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    // Relee sola: el 409 no piso nada y el usuario tiene que decidir sobre los datos de ahora.
    httpMock.expectOne(HABILITACIONES).flush(SIN_RESTRINGIR);
    httpMock.expectOne(esListadoDeOfertas()).flush([{ ...OFERTA_CARGADA, version: 9 }]);
    httpMock.expectOne(esListado(MEMBERSHIPS)).flush({ content: [] });
    httpMock.expectOne(esListado(ESPACIOS)).flush({ content: [] });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('sin sede elegida no pide nada y ofrece elegir contexto', async () => {
    // La oferta pertenece a una sede concreta: pedir sin contexto es un rechazo garantizado.
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HabilitacionesDeLaOfertaPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Elegi una sede');
  });

  it('un error de carga se puede reintentar', async () => {
    contexto.select({
      organizationId: ORG,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });
    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(HabilitacionesDeLaOfertaPage);
    fixture.detectChanges();

    httpMock
      .expectOne(HABILITACIONES)
      .flush({ title: 'Se rompio' }, { status: 500, statusText: 'Server Error' });
    httpMock.expectOne(esListadoDeOfertas()).flush([OFERTA_CARGADA]);
    httpMock.expectOne(esListado(MEMBERSHIPS)).flush({ content: [] });
    httpMock.expectOne(esListado(ESPACIOS)).flush({ content: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(botonPorTexto(fixture, 'Reintentar')).not.toBeNull();
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(
    configuracion: object = SIN_RESTRINGIR,
  ): Promise<ComponentFixture<HabilitacionesDeLaOfertaPage>> {
    contexto.select({
      organizationId: ORG,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(HabilitacionesDeLaOfertaPage);
    fixture.detectChanges();

    httpMock.expectOne(HABILITACIONES).flush(configuracion);
    httpMock.expectOne(esListadoDeOfertas()).flush([OFERTA_CARGADA]);
    httpMock.expectOne(esListado(MEMBERSHIPS)).flush({
      content: [{ id: 77, accountName: 'Ana Gomez', roleCode: 'PROFESIONAL', estado: 'ACTIVA' }],
    });
    httpMock.expectOne(esListado(ESPACIOS)).flush({
      content: [{ id: 10, name: 'Box 1', capacidad: 1 }],
    });

    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  function esListadoDeOfertas() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === OFERTAS;
  }

  /** Compara solo el camino: estas tres llevan query params y `expectOne(string)` no las toma. */
  function esListado(url: string) {
    return (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === url;
  }

  function marcar(fixture: ComponentFixture<HabilitacionesDeLaOfertaPage>, indice: number): void {
    const casillas = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    casillas[indice].click();
    fixture.detectChanges();
  }

  function botonPorTexto(
    fixture: ComponentFixture<HabilitacionesDeLaOfertaPage>,
    texto: string,
  ): HTMLButtonElement | null {
    const botones = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ) as HTMLButtonElement[];
    return botones.find((boton) => boton.textContent?.trim().includes(texto)) ?? null;
  }
});
