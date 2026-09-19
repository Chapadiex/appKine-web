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

  it('desmarcar al ultimo profesional avisa EN VIVO que la oferta queda abierta a todos', async () => {
    // El caso peligroso de la pantalla: quien desmarca la ultima casilla cree que restringe y
    // en realidad abre la oferta al centro entero. El aviso tiene que cambiar ANTES de guardar,
    // porque despues el cambio ya esta hecho.
    const fixture = await montar({
      ...SIN_RESTRINGIR,
      restringidaPorProfesional: true,
      profesionales: [
        {
          membershipId: 77,
          nombre: 'Ana Gomez',
          roleCode: 'PROFESIONAL',
          estado: 'ACTIVO',
          vinculoVigente: true,
        },
      ],
    });

    expect(casillas(fixture)[0].checked).toBe(true);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Solo los marcados van a poder prestar esta oferta',
    );

    marcar(fixture, 0);

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'la oferta queda sin restringir',
    );

    botonPorTexto(fixture, 'Guardar los profesionales')?.click();
    fixture.detectChanges();

    const guardado = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${HABILITACIONES}/profesionales`,
    );
    // Se manda el conjunto completo, que ahora es vacio: el servidor hace el diff.
    expect((guardado.request.body as { ids: number[] }).ids).toEqual([]);

    guardado.flush(SIN_RESTRINGIR);
    await fixture.whenStable();
    fixture.detectChanges();
    httpMock.expectOne(esListadoDeOfertas()).flush([OFERTA_CARGADA]);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('una respuesta sin los campos opcionales no pinta "undefined" en ninguna fila', async () => {
    // El contrato declara opcionales TODOS los campos de estas filas. Sin los respaldos, una
    // respuesta parcial deja al administrador eligiendo entre "Profesional #undefined" y
    // "undefined personas", que es peor que no mostrar la fila.
    const fixture = await montar(
      {
        ...SIN_RESTRINGIR,
        restringidaPorProfesional: true,
        restringidaPorEspacio: true,
        profesionales: [{ membershipId: 88, estado: 'ACTIVO' }],
        espacios: [{ espacioId: 10, estado: 'ACTIVO' }],
      },
      { colaboradores: [{ id: 77, accountEmail: 'ana@centro.test', estado: 'ACTIVA' }] },
    );

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Profesional #88');
    expect(texto).toContain('Espacio #10');
    // El colaborador sin nombre cargado se identifica por su correo, no por su numero.
    expect(texto).toContain('ana@centro.test');
    expect(texto).not.toContain('undefined');
    expect(texto).not.toContain('NaN');
  });

  it('si no se pudo releer la oferta, guardar no manda nada a la red', async () => {
    // Sin la `version` de la oferta el guardado se corta solo: mandar una inventada pisaria el
    // cambio de otro, que es lo que el control optimista existe para impedir.
    const fixture = await montar(SIN_RESTRINGIR, { ofertaPerdida: true });

    marcar(fixture, 0);
    botonPorTexto(fixture, 'Guardar los profesionales')?.click();
    fixture.detectChanges();

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
  });

  it('un 403 al guardar explica que falta administrar la sede, y no oculta la lista', async () => {
    const fixture = await montar();

    marcar(fixture, 0);
    botonPorTexto(fixture, 'Guardar los profesionales')?.click();
    fixture.detectChanges();

    const guardado = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${HABILITACIONES}/profesionales`,
    );

    // Mientras la peticion viaja las casillas quedan apagadas: un segundo envio con el mismo
    // `expectedVersion` termina en un 409 que le echa la culpa a una edicion ajena inexistente.
    fixture.detectChanges();
    expect(casillas(fixture)[0].disabled).toBe(true);

    guardado.flush({ title: 'Prohibido' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    fixture.detectChanges();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('hace falta administrarla');
    // Recargar no consigue el permiso que falta: ofrecerlo manda a dar vueltas.
    expect(botonPorTexto(fixture, 'Recargar la configuracion')).toBeNull();
    // Y la configuracion se sigue viendo: consultarla si se puede.
    expect(casillas(fixture).length).toBeGreaterThan(0);
  });

  it('un 404 al guardar ofrece recargar la configuracion', async () => {
    // La oferta ya no existe o no es de esta sede: reintentar el mismo PUT falla igual.
    const fixture = await montar();

    marcar(fixture, 0);
    botonPorTexto(fixture, 'Guardar los profesionales')?.click();
    fixture.detectChanges();

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${HABILITACIONES}/profesionales`,
      )
      .flush({ title: 'No existe' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Esa oferta ya no existe');

    botonPorTexto(fixture, 'Recargar la configuracion')?.click();
    fixture.detectChanges();

    httpMock.expectOne(HABILITACIONES).flush(SIN_RESTRINGIR);
    httpMock.expectOne(esListadoDeOfertas()).flush([OFERTA_CARGADA]);
    httpMock.expectOne(esListado(MEMBERSHIPS)).flush({ content: [] });
    httpMock.expectOne(esListado(ESPACIOS)).flush({ content: [] });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('un 409 sin tipo propio muestra el detalle del backend y ofrece recargar', async () => {
    // Los conflictos de invariante de esta etapa no tienen `problemType` publicado: el unico
    // texto que nombra cual fue es el `detail`. Reemplazarlo por un generico lo tira.
    const fixture = await montar();

    marcar(fixture, 1);
    botonPorTexto(fixture, 'Guardar los espacios')?.click();
    fixture.detectChanges();

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'PUT' && peticion.url === `${HABILITACIONES}/espacios`,
      )
      .flush(
        { detail: 'La oferta esta dada de baja y no admite habilitaciones nuevas.' },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'La oferta esta dada de baja y no admite habilitaciones nuevas.',
    );
    expect(botonPorTexto(fixture, 'Recargar la configuracion')).not.toBeNull();
  });

  it('sin permiso de administrar la sede no se ofrece ningun guardado', async () => {
    // Ofrecer un boton que termina en 403 es peor que no ofrecerlo: quien lo aprieta cree que
    // cambio la configuracion. La lectura si se permite, y por eso las casillas se ven.
    const fixture = await montar(SIN_RESTRINGIR, { otorgados: [] });

    expect(botonPorTexto(fixture, 'Guardar los profesionales')).toBeNull();
    expect(botonPorTexto(fixture, 'Guardar los espacios')).toBeNull();
    expect(casillas(fixture).length).toBeGreaterThan(0);
  });

  it('un vinculo que ya no esta activo no se ofrece como candidato', async () => {
    // Habilitar a alguien cuyo vinculo se corto crea una habilitacion que nace muerta, y la
    // lista de candidatos es el unico lugar donde se puede evitar.
    const fixture = await montar(SIN_RESTRINGIR, {
      colaboradores: [
        { id: 77, accountName: 'Ana Gomez', roleCode: 'PROFESIONAL', estado: 'ACTIVA' },
        { id: 88, accountName: 'Leo Perez', roleCode: 'PROFESIONAL', estado: 'REVOCADA' },
      ],
    });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Ana Gomez');
    expect(texto).not.toContain('Leo Perez');
  });

  it('si fallan los candidatos la pantalla sigue en pie y dice que no hay ninguno', async () => {
    // Un error al traer candidatos no rompe la pantalla: la configuracion actual es lo que el
    // usuario vino a ver. Lo que no puede pasar es que una lista corta se lea como "nadie".
    const fixture = await montar(SIN_RESTRINGIR, { candidatosCaidos: true });

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Todavia no hay ningun profesional configurado');
    expect(texto).toContain('asi que hoy la puede prestar cualquiera');
    expect(texto).toContain('Todavia no hay ningun espacio configurado');
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

  /** Lo que se puede variar del montaje. Todo lo no dicho toma el camino feliz. */
  interface Opciones {
    /** Permisos otorgados. Vacio = solo lectura. */
    readonly otorgados?: readonly string[];
    /** Colaboradores que devuelve el listado de vinculos de la organizacion. */
    readonly colaboradores?: readonly object[];
    /** `true` para que falle el repedido de la oferta y `oferta()` quede en `null`. */
    readonly ofertaPerdida?: boolean;
    /** `true` para que fallen las dos consultas de candidatos. */
    readonly candidatosCaidos?: boolean;
  }

  const ERROR_500: [object, { status: number; statusText: string }] = [
    { title: 'Se rompio' },
    { status: 500, statusText: 'Server Error' },
  ];

  async function montar(
    configuracion: object = SIN_RESTRINGIR,
    opciones: Opciones = {},
  ): Promise<ComponentFixture<HabilitacionesDeLaOfertaPage>> {
    contexto.select({
      organizationId: ORG,
      organizationName: 'Centro Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({
      permissions: [...(opciones.otorgados ?? [PERMISO_CONSULTORIO_MANAGE])],
    });

    const fixture = TestBed.createComponent(HabilitacionesDeLaOfertaPage);
    fixture.detectChanges();

    httpMock.expectOne(HABILITACIONES).flush(configuracion);

    const ofertas = httpMock.expectOne(esListadoDeOfertas());
    if (opciones.ofertaPerdida === true) {
      ofertas.flush(...ERROR_500);
    } else {
      ofertas.flush([OFERTA_CARGADA]);
    }

    const vinculos = httpMock.expectOne(esListado(MEMBERSHIPS));
    const espacios = httpMock.expectOne(esListado(ESPACIOS));
    if (opciones.candidatosCaidos === true) {
      vinculos.flush(...ERROR_500);
      espacios.flush(...ERROR_500);
    } else {
      vinculos.flush({
        content: opciones.colaboradores ?? [
          { id: 77, accountName: 'Ana Gomez', roleCode: 'PROFESIONAL', estado: 'ACTIVA' },
        ],
      });
      espacios.flush({ content: [{ id: 10, name: 'Box 1', capacidad: 1 }] });
    }

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

  function casillas(
    fixture: ComponentFixture<HabilitacionesDeLaOfertaPage>,
  ): readonly HTMLInputElement[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ),
    ];
  }

  function marcar(fixture: ComponentFixture<HabilitacionesDeLaOfertaPage>, indice: number): void {
    casillas(fixture)[indice].click();
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
