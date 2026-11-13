import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { CatalogoDeServiciosPage, codigoSugerido } from './catalogo-de-servicios-page';
import { RUTA_SERVICIOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { PlatformRoleStore } from '../../../../core/services/platform-role.store';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';

const KINE = {
  id: 1,
  codigo: 'KRES',
  nombre: 'Kinesiologia respiratoria',
  descripcion: 'Rehabilitacion respiratoria',
  naturaleza: 'CLINICO',
  modalidadDefault: 'INDIVIDUAL',
  requiereCasoClinicoDefault: true,
  generaRegistroClinicoDefault: true,
  estado: 'ACTIVO',
  version: 2,
};

const PILATES = {
  id: 2,
  codigo: 'PIL',
  nombre: 'Pilates',
  naturaleza: 'BIENESTAR',
  modalidadDefault: 'GRUPAL',
  requiereCasoClinicoDefault: false,
  generaRegistroClinicoDefault: false,
  estado: 'ACTIVO',
  version: 1,
};

/**
 * Spec del catalogo global de servicios (M27, AKINE-02.06).
 *
 * <p>Cubre lo que el criterio de aceptacion exige y nada mas: render, filtro, alta feliz y el
 * `409` de concurrencia. <b>No hay tests de getters ni de etiquetas</b>: si `etiquetaDeNaturaleza`
 * se rompe, se ve en la primera fila de la primera pantalla que alguien abra.
 *
 * <p>El caso que si merece un test propio es el `409`, porque su sintoma cuando esta mal es
 * <b>invisible</b>: el cambio de otra persona se pisa y el servidor responde `200`.
 */
describe('CatalogoDeServiciosPage', () => {
  let httpMock: HttpTestingController;

  /**
   * Rol de plataforma de la cuenta que mira. Por defecto `true`: casi todos los casos ejercitan
   * las mutaciones, que solo se muestran con ese rol. El store real tiene su propio spec.
   */
  const esAdmin = signal(true);
  /** `catalogo:manage` en el contexto: administra los servicios propios del centro (0.163.0). */
  const gestionaCatalogo = signal(false);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogoDeServiciosPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        {
          provide: PlatformRoleStore,
          useValue: {
            esAdminDePlataforma: esAdmin.asReadonly(),
            resolver: () => of(esAdmin()),
          },
        },
        {
          provide: PermissionsStore,
          useValue: {
            tiene: (permiso: string) => permiso === 'catalogo:manage' && gestionaCatalogo(),
            asegurarCargados: () => undefined,
          },
        },
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    esAdmin.set(true);
    gestionaCatalogo.set(false);
    vi.useRealTimers();
    httpMock.verify();
  });

  it('con rol de plataforma lista el catalogo con sus acciones', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    expect(anfitrion.querySelectorAll('tbody tr').length).toBe(2);
    expect(anfitrion.textContent).toContain('Kinesiologia respiratoria');
    expect(anfitrion.textContent).toContain('Bienestar');
    // Patron de listado (UX-14): conteo en la toolbar y pie estandar.
    expect(anfitrion.querySelector('.filtros-barra__resultados')?.textContent).toContain(
      '2 servicios',
    );
    expect(anfitrion.querySelector('.paginacion-pie')?.textContent).toContain('Mostrando 1–2 de 2');

    expect(anfitrion.textContent).toContain('Tu cuenta tiene rol de plataforma');
    expect(anfitrion.textContent).toContain('Nuevo servicio');
    // "En la sede" a la vista (11/11/2026); Editar y la baja, destructiva, en el menu "⋯".
    const acciones = [...anfitrion.querySelectorAll('tbody button')].map((boton) =>
      (boton.textContent ?? '').trim(),
    );
    expect(acciones).toEqual([
      'Más acciones de Kinesiologia respiratoria',
      'Editar',
      'Dar de baja',
      'Más acciones de Pilates',
      'Editar',
      'Dar de baja',
    ]);
    expect(
      anfitrion.querySelector('tbody a[href^="/servicios/ofertas?servicio="]')?.textContent,
    ).toContain('En la sede');

    // Y hay salida hacia lo que el centro SI administra.
    expect(anfitrion.querySelector('a[href="/servicios/ofertas"]')).not.toBeNull();
  });

  it('sin rol de plataforma no ofrece alta, edicion ni baja, y explica por que', async () => {
    esAdmin.set(false);
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    // El listado se ve igual: leer el catalogo alcanza con estar autenticado.
    expect(anfitrion.querySelectorAll('tbody tr').length).toBe(2);

    const botones = [...anfitrion.querySelectorAll('button')].map((boton) =>
      (boton.textContent ?? '').trim(),
    );
    expect(botones).not.toContain('Nuevo servicio');
    expect(anfitrion.querySelectorAll('tbody button').length).toBe(0);
    // Sin columna vacia de acciones.
    const encabezados = [...anfitrion.querySelectorAll('thead th')].map((celda) =>
      (celda.textContent ?? '').trim(),
    );
    expect(encabezados).not.toContain('Acciones');

    expect(anfitrion.textContent).toContain('Tu cuenta solo puede consultarlo');
    expect(anfitrion.querySelector('a[href="/servicios/ofertas"]')).not.toBeNull();
  });

  it('con catalogo:manage el centro da de alta servicios propios y solo toca los suyos', async () => {
    esAdmin.set(false);
    gestionaCatalogo.set(true);
    const fixture = TestBed.createComponent(CatalogoDeServiciosPage);
    fixture.detectChanges();
    httpMock
      .expectOne(esListado())
      .flush([
        KINE,
        { ...PILATES, id: 3, nombre: 'Yoga', codigo: 'YOGA', alcance: 'ORGANIZACION' },
      ]);
    await fixture.whenStable();
    fixture.detectChanges();
    const anfitrion = fixture.nativeElement as HTMLElement;

    const botones = [...anfitrion.querySelectorAll('button')].map((boton) =>
      (boton.textContent ?? '').trim(),
    );
    expect(botones).toContain('Nuevo servicio');
    // El global no se toca desde el centro; el propio si.
    const filas = [...anfitrion.querySelectorAll('tbody tr')];
    expect(filas[0].querySelectorAll('button').length).toBe(0);
    expect(filas[1].textContent).toContain('Del centro');
    expect(filas[1].querySelectorAll('button').length).toBeGreaterThan(0);

    (anfitrion.querySelector('[cabeceraAcciones] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(anfitrion.textContent).toContain('Creá un servicio para tu organización');
  });

  it('el filtro de estado recarga con su parametro y una lista vacía no es un error', async () => {
    const fixture = await montar();

    elegir(fixture, '#filtro-estado-servicio', 'INACTIVO');
    const porEstado = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === RUTA_SERVICIOS && peticion.params.get('estado') === 'INACTIVO',
    );
    porEstado.flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    // Vacio filtrado (UX-14): no es "no hay ninguno", y ofrece limpiar.
    const anfitrion = fixture.nativeElement as HTMLElement;
    const vacio = anfitrion.querySelector('app-estado-vacio');
    expect(vacio?.textContent).toContain('No encontramos servicios');
    expect(anfitrion.querySelector('.filtros-barra__resultados')?.textContent).toContain(
      '0 servicios',
    );
    [...(vacio?.querySelectorAll('button') ?? [])]
      .find((boton) => boton.textContent?.includes('Limpiar filtros'))
      ?.click();
    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.url === RUTA_SERVICIOS && peticion.params.get('estado') === 'ACTIVO',
      )
      .flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(anfitrion.querySelector('app-estado-vacio')?.textContent).toContain(
      'Todavía no hay servicios activos en el catálogo',
    );
  });

  it('cambiar el filtro con una consulta en vuelo la cancela: no gana la que llega última', async () => {
    const fixture = await montar();

    elegir(fixture, '#filtro-estado-servicio', 'TODOS');
    const vieja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.params.get('estado') === 'TODOS',
    );
    elegir(fixture, '#filtro-estado-servicio', 'INACTIVO');
    const nueva = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.params.get('estado') === 'INACTIVO',
    );

    expect(vieja.cancelled).toBe(true);
    nueva.flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No encontramos servicios',
    );
  });

  it('el alta manda los cinco campos del contrato y omite la descripción vacía', async () => {
    const fixture = await montar();

    abrir(fixture, 'Nuevo servicio');

    // Primero sin completar nada: no sale ninguna peticion y se marcan los obligatorios.
    enviar(fixture, 'form[novalidate]');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Ingresá el código del servicio.',
    );

    escribir(fixture, '#alta-servicio-codigo', 'EVP');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluación postural');
    elegir(fixture, '#alta-servicio-naturaleza', 'PREVENTIVO');
    elegir(fixture, '#alta-servicio-modalidad', 'INDIVIDUAL');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === RUTA_SERVICIOS,
    );
    expect(alta.request.body).toEqual({
      codigo: 'EVP',
      nombre: 'Evaluación postural',
      naturaleza: 'PREVENTIVO',
      modalidadDefault: 'INDIVIDUAL',
      requiereCasoClinicoDefault: false,
      generaRegistroClinicoDefault: false,
    });

    alta.flush({ ...PILATES, id: 3, codigo: 'EVP', nombre: 'Evaluación postural' });
    httpMock.expectOne(esListado()).flush([KINE, PILATES]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'lo ven todos los centros',
    );
  });

  it('el 409 conflict no pisa nada: relee, deja el panel abierto y explica', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', 'Kinesiologia respiratoria adultos');
    enviar(fixture, 'form[novalidate]');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'PUT' && peticion.url === `${RUTA_SERVICIOS}/1`,
    );
    // Solo lo que cambio, mas la version. Mandar todo pisaria campos que nadie toco.
    expect(edicion.request.body).toEqual({
      expectedVersion: 2,
      nombre: 'Kinesiologia respiratoria adultos',
    });

    // El tipo es `concurrent-modification` (DP-21): es lo que emite el handler global para
    // el bloqueo optimista. Ver `offering-errors.ts`.
    edicion.flush(
      {
        type: 'https://akine.app/problems/concurrent-modification',
        detail: 'la versión quedo vieja',
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();

    // Se relee para tomar la version nueva como base, y NO se reintenta solo: reintentar en
    // silencio seria pisar el cambio del otro, que es lo que el 409 evita.
    httpMock.expectOne(esListado()).flush([{ ...KINE, version: 9 }, PILATES]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('no guardamos tus cambios para no pisar los suyos');
    // El panel sigue abierto con lo que el usuario habia escrito.
    expect(anfitrion.querySelector<HTMLInputElement>('#editar-servicio-nombre')?.value).toBe(
      'Kinesiologia respiratoria adultos',
    );
  });

  it(
    'la pantalla no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('un código en uso se muestra pegado a los campos, no como error general (UX-12)', async () => {
    const fixture = await montar();

    abrir(fixture, 'Nuevo servicio');
    escribir(fixture, '#alta-servicio-codigo', 'KRES');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluación postural');
    elegir(fixture, '#alta-servicio-naturaleza', 'PREVENTIVO');
    elegir(fixture, '#alta-servicio-modalidad', 'INDIVIDUAL');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'POST' && peticion.url === RUTA_SERVICIOS,
      )
      .flush(
        {
          type: 'https://akine.app/problems/servicio-codigo-taken',
          status: 409,
          detail: 'codigo en uso',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    const alerta = anfitrion.querySelector('#alta-servicio-duplicado');
    expect(alerta?.getAttribute('role')).toBe('alert');
    expect(alerta?.textContent).toContain('Ya hay un servicio vigente con ese código');
    const codigo = anfitrion.querySelector('#alta-servicio-codigo');
    expect(codigo?.getAttribute('aria-invalid')).toBe('true');
    expect(codigo?.getAttribute('aria-describedby')).toBe('alta-servicio-duplicado');
    // Una sola alerta: el duplicado no se repite como error general arriba del formulario.
    expect(anfitrion.querySelectorAll('app-alerta').length).toBe(1);
  });

  it('el 403 de una mutacion explica que el catalogo es de la plataforma, y no cierra sesión', async () => {
    // Ocultar es UX: con el boton a la vista (rol revocado a mitad de sesion, por ejemplo) el
    // backend igual rechaza, y el mensaje tiene que explicar de quien es el catalogo para que
    // el usuario no lea el 403 como un error suyo.
    const fixture = await montar();

    abrir(fixture, 'Nuevo servicio');
    escribir(fixture, '#alta-servicio-codigo', 'EVP');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluación postural');
    elegir(fixture, '#alta-servicio-naturaleza', 'PREVENTIVO');
    elegir(fixture, '#alta-servicio-modalidad', 'INDIVIDUAL');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'POST' && peticion.url === RUTA_SERVICIOS,
      )
      .flush(
        {
          type: 'https://akine.app/problems/forbidden',
          title: 'Acceso denegado',
          status: 403,
          detail: 'No tiene permiso para realizar esta operación',
        },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('rol de plataforma');
    // El panel queda abierto: lo que el usuario escribio no se pierde por un rechazo suyo.
    expect(anfitrion.querySelector('#alta-servicio-codigo')).not.toBeNull();
  });

  it('la baja exige motivo y explica que NO cascadea sobre las ofertas', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    const baja = [...anfitrion.querySelectorAll('tbody button')].find(
      (boton) => (boton.textContent ?? '').trim() === 'Dar de baja',
    );
    (baja as HTMLButtonElement).click();
    fixture.detectChanges();

    // El texto de ayuda es la unica parte de la interfaz donde el usuario se entera de que dar
    // de baja un servicio no rompe las ofertas que ya lo prestan. Si desaparece, la accion
    // parece mas destructiva de lo que es y nadie la usa.
    expect(anfitrion.textContent).toContain('NO cascadea');

    const motivo = anfitrion.querySelector('#baja-servicio-motivo') as HTMLTextAreaElement | null;
    expect(motivo).not.toBeNull();
  });

  it('si el listado no llega por falta de red, ofrece reintentar y el reintento vuelve a pedir', async () => {
    // El error de red es el unico que no trae `ProblemDetail`: si la pantalla se quedara en
    // "Cargando..." el usuario no tendria de donde volver, y este estado no se distingue de
    // una peticion lenta mirando la pantalla.
    const fixture = TestBed.createComponent(CatalogoDeServiciosPage);
    fixture.detectChanges();

    httpMock
      .expectOne(esListado())
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('No se pudo contactar al servidor');

    abrir(fixture, 'Reintentar');
    httpMock.expectOne(esListado()).flush([KINE, PILATES]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('un 429 en el alta dice cuantos segundos esperar y no borra lo que el usuario escribio', async () => {
    // Sin el plazo el usuario reintenta de inmediato y vuelve a chocar contra el limite. Y si
    // el panel se cerrara, tendria que reescribir los cinco campos en cada rebote.
    const fixture = await montar();

    abrir(fixture, 'Nuevo servicio');
    escribir(fixture, '#alta-servicio-codigo', 'EVP');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluación postural');
    elegir(fixture, '#alta-servicio-naturaleza', 'PREVENTIVO');
    elegir(fixture, '#alta-servicio-modalidad', 'INDIVIDUAL');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'POST')
      .flush(
        { type: 'https://akine.app/problems/rate-limited', detail: 'Demasiados intentos' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '45' } },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('Espera 45 segundos');
    expect(anfitrion.querySelector<HTMLInputElement>('#alta-servicio-codigo')?.value).toBe('EVP');
  });

  it('un 404 al editar ofrece recargar el listado, que es lo unico que lo resuelve', async () => {
    // El servicio se dio de baja o se borro desde otra sesion: insistir con el mismo `PUT`
    // vuelve a fallar siempre. La salida es releer, y tiene que estar en pantalla.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', 'Kinesiologia respiratoria adultos');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/not-found', detail: 'No existe' },
        { status: 404, statusText: 'Not Found' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('ya no existe en el catalogo');

    abrir(fixture, 'Recargar el listado');
    httpMock.expectOne(esListado()).flush([PILATES]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(anfitrion.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('la edicion con el nombre vacío no emite el PUT', async () => {
    // Un test que solo mirara el texto del error pasaria igual aunque la peticion saliera: lo
    // que importa es que el envio quede BLOQUEADO, porque el nombre vacio viajaria como un
    // cambio deliberado y el backend lo rechazaria con un 400 que no explica nada.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', '');
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Ingresá el nombre del servicio.',
    );
  });

  it('la edicion con un nombre de solo espacios tampoco emite el PUT', async () => {
    // `Validators.required` mide longitud, asi que '   ' lo daba por valido y el `.trim()` de
    // `armarCambios()` mandaba `nombre: ''`: el mismo 400 que el caso de arriba evita, por un
    // camino que ningun test recorria.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', '   ');
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Ingresá el nombre del servicio.',
    );
  });

  it('la baja sin motivo no sale a la red, y con motivo se confirma y se relee', async () => {
    // El motivo es obligatorio en el backend: gastar un rechazo para enterarse deja al usuario
    // con un error generico en vez de con el campo marcado.
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Dar de baja');
    enviar(fixture, 'form[novalidate]');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'DELETE');

    escribir(fixture, '#baja-servicio-motivo', 'Se deja de prestar en toda la red');
    enviar(fixture, 'form[novalidate]');

    const baja = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'DELETE' && peticion.url === `${RUTA_SERVICIOS}/1`,
    );
    expect(baja.request.body).toEqual({ reason: 'Se deja de prestar en toda la red' });
    baja.flush({ ...KINE, estado: 'INACTIVO' });
    httpMock.expectOne(esListado()).flush([PILATES]);
    await fixture.whenStable();
    fixture.detectChanges();

    // El aviso de exito es donde el usuario confirma que las ofertas vivas no se rompieron.
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Servicio dado de baja');
    expect(aviso?.descripcion).toContain('siguen funcionando');
    expect(anfitrion.querySelector('app-panel-lateral')).toBeNull();
  });

  it('un 409 sin tipo propio en la baja muestra el detail del backend y deja el panel abierto', async () => {
    // Los 409 de unicidad y de baja ya hecha no tienen `problemType` publicado: si la pantalla
    // mostrara su generico, el usuario perderia la unica frase que nombra el conflicto real.
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    escribir(fixture, '#baja-servicio-motivo', 'Duplicado');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'DELETE')
      .flush(
        {
          type: 'https://akine.app/problems/servicio-already-inactive',
          title: 'Conflicto',
          status: 409,
          detail: 'El servicio ya estaba dado de baja',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('El servicio ya estaba dado de baja');
    expect(anfitrion.querySelector('#baja-servicio-motivo')).not.toBeNull();
    // Y ofrece releer, que es lo unico que cambia el resultado del proximo intento.
    expect(
      [...anfitrion.querySelectorAll('button')].map((boton) => (boton.textContent ?? '').trim()),
    ).toContain('Recargar el listado');
  });

  it('si la relectura posterior al 409 también falla, el mensaje queda y la pantalla no se rompe', async () => {
    // Es el caso encadenado: el servidor conflictua y ademas se cae. Si la relectura fallida
    // vaciara el listado o tirara la excepcion, el usuario perderia la tabla ademas del cambio.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', 'Kinesiologia respiratoria adultos');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', detail: 'versión vieja' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();

    httpMock
      .expectOne(esListado())
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('no guardamos tus cambios para no pisar los suyos');
    expect(anfitrion.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
  });

  it('la búsqueda incremental hace una sola peticion por rafaga de teclas', async () => {
    // Sin el debounce sale una peticion por tecla: cinco letras son cinco listados y el ultimo
    // en llegar no tiene por que ser el de la ultima tecla, asi que la tabla puede quedar
    // mostrando el resultado de una busqueda que el usuario ya no tiene escrita.
    const fixture = await montar();

    vi.useFakeTimers();
    escribir(fixture, '#busqueda-servicio', 'ki');
    escribir(fixture, '#busqueda-servicio', 'kin');
    escribir(fixture, '#busqueda-servicio', 'kine');
    vi.advanceTimersByTime(300);
    vi.useRealTimers();
    fixture.detectChanges();

    const pedidos = httpMock.match(esListado());
    expect(pedidos.length).toBe(1);
    expect(pedidos[0].request.params.get('q')).toBe('kine');
    pedidos[0].flush([KINE]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(1);
  });

  it('la edicion manda cada campo que cambio, incluida la descripción vaciada a proposito', async () => {
    // La descripcion vacia es el caso que se pierde si alguien "simplifica" omitiendo los
    // campos vacios: el contrato no publica ningun `limpiarDescripcion`, asi que la cadena
    // vacia es la UNICA forma de borrarla y omitirla deja el dato viejo para siempre.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-descripcion', '');
    elegir(fixture, '#editar-servicio-naturaleza', 'PREVENTIVO');
    elegir(fixture, '#editar-servicio-modalidad', 'GRUPAL');
    marcar(fixture, '#editar-servicio-caso', false);
    marcar(fixture, '#editar-servicio-registro', false);
    enviar(fixture, 'form[novalidate]');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );
    const cuerpo = edicion.request.body as Record<string, unknown>;
    expect(cuerpo).toEqual({
      expectedVersion: 2,
      descripcion: '',
      naturaleza: 'PREVENTIVO',
      modalidadDefault: 'GRUPAL',
      requiereCasoClinicoDefault: false,
      generaRegistroClinicoDefault: false,
    });
    // El nombre no se toco: mandarlo igual pisaria el renombre de otra persona.
    expect('nombre' in cuerpo).toBe(false);

    edicion.flush({ ...KINE, version: 3 });
    httpMock.expectOne(esListado()).flush([KINE, PILATES]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      TestBed.inject(AvisosStore)
        .avisos()
        .map((aviso) => aviso.titulo),
    ).toEqual(['Cambios guardados']);
    expect((fixture.nativeElement as HTMLElement).querySelector('app-panel-lateral')).toBeNull();
  });

  it('el código se propone desde el nombre hasta que el usuario lo escribe a mano', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;
    const codigo = () => anfitrion.querySelector<HTMLInputElement>('#alta-servicio-codigo')?.value;

    abrir(fixture, 'Nuevo servicio');
    escribir(fixture, '#alta-servicio-nombre', 'Kinesiología respiratoria');
    expect(codigo()).toBe('KINESIOLOGIA-RESPIRATORIA');

    // Una vez tocado, el nombre ya no lo pisa: lo que escribió el usuario manda.
    escribir(fixture, '#alta-servicio-codigo', 'KRES-2');
    escribir(fixture, '#alta-servicio-nombre', 'Kinesiología respiratoria infantil');
    expect(codigo()).toBe('KRES-2');
  });

  it('codigoSugerido saca tildes y símbolos, no deja guiones en los bordes y corta en 64', () => {
    expect(codigoSugerido('  ¡Pilates & Yoga! (Ñandú)  ')).toBe('PILATES-YOGA-NANDU');
    expect(codigoSugerido('---')).toBe('');
    expect(codigoSugerido('a'.repeat(80))).toHaveLength(64);
  });

  it('cerrar el alta con cambios pregunta antes de descartarlos; sin cambios cierra directo', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    // Sin tocar nada no hay nada que perder.
    abrir(fixture, 'Nuevo servicio');
    abrir(fixture, 'Cancelar');
    expect(anfitrion.querySelector('app-panel-lateral')).toBeNull();

    abrir(fixture, 'Nuevo servicio');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluación postural');
    abrir(fixture, 'Cancelar');
    expect(anfitrion.querySelector('[role="alertdialog"]')?.textContent).toContain(
      '¿Descartar cambios?',
    );
    expect(anfitrion.querySelector('app-panel-lateral')).not.toBeNull();

    // "Seguir editando" vuelve al formulario con lo escrito intacto.
    abrir(fixture, 'Seguir editando');
    expect(anfitrion.querySelector('[role="alertdialog"]')).toBeNull();
    expect(anfitrion.querySelector<HTMLInputElement>('#alta-servicio-nombre')?.value).toBe(
      'Evaluación postural',
    );

    abrir(fixture, 'Cancelar');
    abrir(fixture, 'Descartar cambios');
    expect(anfitrion.querySelector('app-panel-lateral')).toBeNull();
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
  });

  it('la X del panel de edición con cambios también pide confirmar el descarte', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', 'Otro nombre');
    anfitrion.querySelector<HTMLButtonElement>('.panel-lateral__cerrar')?.click();
    fixture.detectChanges();

    expect(anfitrion.textContent).toContain('¿Descartar cambios?');
    expect(anfitrion.querySelector('app-panel-lateral')).not.toBeNull();
  });

  it('un texto más largo de lo que acepta el backend no se envía y dice el límite', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    abrir(fixture, 'Nuevo servicio');
    escribir(fixture, '#alta-servicio-codigo', 'C'.repeat(65));
    escribir(fixture, '#alta-servicio-nombre', 'N'.repeat(161));
    escribir(fixture, '#alta-servicio-descripcion', 'D'.repeat(281));
    elegir(fixture, '#alta-servicio-naturaleza', 'PREVENTIVO');
    elegir(fixture, '#alta-servicio-modalidad', 'INDIVIDUAL');
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(anfitrion.textContent).toContain('Usá hasta 64 caracteres.');
    expect(anfitrion.textContent).toContain('Usá hasta 160 caracteres.');
    expect(anfitrion.textContent).toContain('Usá hasta 280 caracteres.');
  });

  it('el alta de un servicio propio manda la descripción y ofrece crear su oferta en la sede', async () => {
    esAdmin.set(false);
    gestionaCatalogo.set(true);
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = await montar();

    abrir(fixture, 'Nuevo servicio');
    escribir(fixture, '#alta-servicio-nombre', 'Yoga');
    escribir(fixture, '#alta-servicio-descripcion', '  Clase de yoga suave  ');
    elegir(fixture, '#alta-servicio-naturaleza', 'BIENESTAR');
    elegir(fixture, '#alta-servicio-modalidad', 'GRUPAL');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(alta.request.body).toMatchObject({ codigo: 'YOGA', descripcion: 'Clase de yoga suave' });
    alta.flush({ ...PILATES, id: 7, nombre: 'Yoga', alcance: 'ORGANIZACION' });
    httpMock.expectOne(esListado()).flush([KINE, PILATES]);
    await fixture.whenStable();

    const avisos = TestBed.inject(AvisosStore);
    const [aviso] = avisos.avisos();
    expect(aviso?.titulo).toBe('Servicio creado');
    expect(aviso?.descripcion).toContain('catálogo de tu organización');
    expect(aviso?.accion?.etiqueta).toBe('Crear oferta');

    avisos.ejecutar(aviso.id);
    expect(navegar).toHaveBeenCalledWith(['/servicios/ofertas'], {
      queryParams: { nuevaOferta: 7 },
    });
  });

  it('el alta de un servicio global no ofrece crear oferta: la plataforma no opera una sede', async () => {
    const fixture = await montar();

    abrir(fixture, 'Nuevo servicio');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluación postural');
    elegir(fixture, '#alta-servicio-naturaleza', 'PREVENTIVO');
    elegir(fixture, '#alta-servicio-modalidad', 'INDIVIDUAL');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'POST')
      .flush({ ...PILATES, id: 8, alcance: 'GLOBAL' });
    httpMock.expectOne(esListado()).flush([KINE, PILATES]);
    await fixture.whenStable();

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Servicio creado');
    expect(aviso?.accion).toBeNull();
  });

  it('un doble envío del alta sale una sola vez', async () => {
    const fixture = await montar();

    abrir(fixture, 'Nuevo servicio');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluación postural');
    elegir(fixture, '#alta-servicio-naturaleza', 'PREVENTIVO');
    elegir(fixture, '#alta-servicio-modalidad', 'INDIVIDUAL');
    enviar(fixture, 'form[novalidate]');
    enviar(fixture, 'form[novalidate]');

    const altas = httpMock.match((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect(altas.length).toBe(1);
    altas[0].flush({ ...PILATES, id: 9 });
    httpMock.expectOne(esListado()).flush([KINE, PILATES]);
    await fixture.whenStable();
  });

  it('editar un servicio al que le faltan campos opcionales no los manda como cambios', async () => {
    // Sin descripción ni defaults clínicos: el formulario los muestra vacíos y apagados, y guardar
    // sin tocar nada no tiene que inventar `descripcion: ''` ni `false`.
    const MINIMO = {
      id: 5,
      codigo: 'MIN',
      nombre: 'Mínimo',
      naturaleza: 'CLINICO',
      modalidadDefault: 'INDIVIDUAL',
      estado: 'ACTIVO',
      version: 3,
    };
    const fixture = await montar([MINIMO]);

    abrir(fixture, 'Editar');
    enviar(fixture, 'form[novalidate]');

    const edicion = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT',
    );
    expect(edicion.request.body).toEqual({ expectedVersion: 3 });
    edicion.flush({ ...MINIMO, nombre: undefined });
    httpMock.expectOne(esListado()).flush([MINIMO]);
    await fixture.whenStable();

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Cambios guardados');
  });

  it('un servicio dado de baja muestra el motivo y no ofrece acciones', async () => {
    const fixture = await montar([
      { ...KINE, estado: 'INACTIVO', deactivationReason: 'Ya no se presta en la red' },
      PILATES,
    ]);
    const [baja] = [...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')];

    expect(baja.textContent).toContain('Dado de baja');
    expect(baja.textContent).toContain('Ya no se presta en la red');
    expect(baja.querySelectorAll('button').length).toBe(0);
  });

  it('un 403 al editar ofrece ir a las ofertas de la sede', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', 'Otro nombre');
    enviar(fixture, 'form[novalidate]');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/forbidden', detail: 'sin rol' },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('No pudimos guardar los cambios');
    expect(
      anfitrion.querySelector('app-panel-lateral a[href="/servicios/ofertas"]')?.textContent,
    ).toContain('Ir a las ofertas de la sede');
  });

  it('un 403 en la baja también ofrece ir a las ofertas de la sede', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de baja');
    escribir(fixture, '#baja-servicio-motivo', 'Duplicado');
    enviar(fixture, 'form[novalidate]');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'DELETE')
      .flush(
        { type: 'https://akine.app/problems/forbidden', detail: 'sin rol' },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.textContent).toContain('No pudimos dar de baja el servicio');
    expect(
      anfitrion.querySelector('app-panel-lateral a[href="/servicios/ofertas"]'),
    ).not.toBeNull();
  });

  it('un nombre en uso al editar se avisa pegado al campo, con el título de la edición', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', 'Pilates');
    enviar(fixture, 'form[novalidate]');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/servicio-nombre-taken', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    const anfitrion = fixture.nativeElement as HTMLElement;
    expect(anfitrion.querySelector('#editar-servicio-duplicado')?.textContent).toContain(
      'Ya hay un servicio con ese nombre',
    );
    expect(anfitrion.querySelector('#editar-servicio-nombre')?.getAttribute('aria-invalid')).toBe(
      'true',
    );
  });

  it('si el servicio editado ya no viene en la relectura tras el 409, la tabla igual se actualiza', async () => {
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', 'Kinesiologia respiratoria adultos');
    enviar(fixture, 'form[novalidate]');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', detail: 'versión vieja' },
        { status: 409, statusText: 'Conflict' },
      );
    fixture.detectChanges();
    httpMock.expectOne(esListado()).flush([PILATES]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr').length).toBe(1);
  });

  async function montar(
    servicios: readonly unknown[] = [KINE, PILATES],
  ): Promise<ComponentFixture<CatalogoDeServiciosPage>> {
    const fixture = TestBed.createComponent(CatalogoDeServiciosPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush(servicios);
    await fixture.whenStable();
    fixture.detectChanges();

    return fixture;
  }

  function esListado() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'GET' && peticion.url === RUTA_SERVICIOS;
  }
});

function elegir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const lista = fixture.nativeElement.querySelector(selector);
  if (lista instanceof HTMLSelectElement) {
    lista.value = valor;
    lista.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    return;
  }
  // Naturaleza y modalidad son tarjetas de opción (radios) desde el 10/11/2026.
  const opcion = fixture.nativeElement.querySelector<HTMLInputElement>(
    `${selector} input[type="radio"][value="${valor}"]`,
  );
  if (opcion === null) {
    throw new Error(`No existe la opción ${valor} en ${selector}`);
  }
  opcion.click();
  fixture.detectChanges();
}

function abrir(fixture: { nativeElement: HTMLElement; detectChanges(): void }, etiqueta: string) {
  const boton = [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === etiqueta,
  );
  if (boton === undefined) {
    throw new Error(`No existe el botón ${etiqueta}`);
  }
  boton.click();
  fixture.detectChanges();
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

function marcar(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: boolean,
) {
  const campo = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe la casilla ${selector}`);
  }
  campo.checked = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = fixture.nativeElement.querySelector<HTMLFormElement>(selector);
  formulario?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
