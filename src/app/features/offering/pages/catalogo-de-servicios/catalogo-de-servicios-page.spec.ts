import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CatalogoDeServiciosPage } from './catalogo-de-servicios-page';
import { RUTA_SERVICIOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CatalogoDeServiciosPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  it('lista el catalogo y avisa que administrarlo es de la plataforma', async () => {
    const fixture = await montar();
    const anfitrion = fixture.nativeElement as HTMLElement;

    expect(anfitrion.querySelectorAll('tbody tr').length).toBe(2);
    expect(anfitrion.textContent).toContain('Kinesiologia respiratoria');
    expect(anfitrion.textContent).toContain('Bienestar');

    // La decision de la pantalla: las acciones SE MUESTRAN aunque hoy no haya forma de saber si
    // el usuario tiene rol de plataforma, y la nota lo anticipa. Ver el javadoc del componente.
    expect(anfitrion.textContent).toContain('rol de plataforma');
    const acciones = [...anfitrion.querySelectorAll('tbody button')].map((boton) =>
      (boton.textContent ?? '').trim(),
    );
    expect(acciones).toEqual(['Editar', 'Dar de baja', 'Editar', 'Dar de baja']);

    // Y hay salida hacia lo que el centro SI administra.
    expect(anfitrion.querySelector('a[href="/servicios/ofertas"]')).not.toBeNull();
  });

  it('el filtro de estado recarga con su parametro y una lista vacia no es un error', async () => {
    const fixture = await montar();

    elegir(fixture, '#filtro-estado-servicio', 'INACTIVO');
    const porEstado = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.url === RUTA_SERVICIOS && peticion.params.get('estado') === 'INACTIVO',
    );
    porEstado.flush([]);
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'No hay servicios que coincidan',
    );
  });

  it('el alta manda los cinco campos del contrato y omite la descripcion vacia', async () => {
    const fixture = await montar();

    abrir(fixture, 'Dar de alta un servicio');

    // Primero sin completar nada: no sale ninguna peticion y se marcan los obligatorios.
    enviar(fixture, 'form[novalidate]');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'POST');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'El codigo es obligatorio',
    );

    escribir(fixture, '#alta-servicio-codigo', 'EVP');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluacion postural');
    elegir(fixture, '#alta-servicio-naturaleza', 'PREVENTIVO');
    elegir(fixture, '#alta-servicio-modalidad', 'INDIVIDUAL');
    enviar(fixture, 'form[novalidate]');

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) =>
        peticion.method === 'POST' && peticion.url === RUTA_SERVICIOS,
    );
    expect(alta.request.body).toEqual({
      codigo: 'EVP',
      nombre: 'Evaluacion postural',
      naturaleza: 'PREVENTIVO',
      modalidadDefault: 'INDIVIDUAL',
      requiereCasoClinicoDefault: false,
      generaRegistroClinicoDefault: false,
    });

    alta.flush({ ...PILATES, id: 3, codigo: 'EVP', nombre: 'Evaluacion postural' });
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

    // El tipo es `conflict`, NO `concurrent-modification`: es lo que emite el handler global
    // para el bloqueo optimista de este modulo. Ver `offering-errors.ts`.
    edicion.flush(
      { type: 'https://akine.app/problems/conflict', detail: 'la version quedo vieja' },
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

  it('el 403 de una mutacion explica que el catalogo es de la plataforma, y no cierra sesion', async () => {
    // Es el caso que sostiene la decision de la pantalla: las acciones se muestran porque hoy
    // ningun endpoint dice si quien mira tiene rol de plataforma, y el rechazo lo da el
    // servidor. Si el mensaje no explicara de quien es el catalogo, el usuario leeria el 403
    // como un error suyo.
    const fixture = await montar();

    abrir(fixture, 'Dar de alta un servicio');
    escribir(fixture, '#alta-servicio-codigo', 'EVP');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluacion postural');
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
          detail: 'No tiene permiso para realizar esta operacion',
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

    abrir(fixture, 'Dar de alta un servicio');
    escribir(fixture, '#alta-servicio-codigo', 'EVP');
    escribir(fixture, '#alta-servicio-nombre', 'Evaluacion postural');
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

  it('la edicion con el nombre vacio no emite el PUT', async () => {
    // Un test que solo mirara el texto del error pasaria igual aunque la peticion saliera: lo
    // que importa es que el envio quede BLOQUEADO, porque el nombre vacio viajaria como un
    // cambio deliberado y el backend lo rechazaria con un 400 que no explica nada.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', '');
    enviar(fixture, 'form[novalidate]');

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'El nombre es obligatorio',
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
      'El nombre es obligatorio',
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

    // El mensaje de exito es donde el usuario confirma que las ofertas vivas no se rompieron.
    expect(anfitrion.textContent).toContain('siguen funcionando');
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

  it('si la relectura posterior al 409 tambien falla, el mensaje queda y la pantalla no se rompe', async () => {
    // Es el caso encadenado: el servidor conflictua y ademas se cae. Si la relectura fallida
    // vaciara el listado o tirara la excepcion, el usuario perderia la tabla ademas del cambio.
    const fixture = await montar();

    abrir(fixture, 'Editar');
    escribir(fixture, '#editar-servicio-nombre', 'Kinesiologia respiratoria adultos');
    enviar(fixture, 'form[novalidate]');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/conflict', detail: 'version vieja' },
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

  it('la busqueda incremental hace una sola peticion por rafaga de teclas', async () => {
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

  it('la edicion manda cada campo que cambio, incluida la descripcion vaciada a proposito', async () => {
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

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('quedaron guardados');
  });

  async function montar(): Promise<ComponentFixture<CatalogoDeServiciosPage>> {
    const fixture = TestBed.createComponent(CatalogoDeServiciosPage);
    fixture.detectChanges();

    httpMock.expectOne(esListado()).flush([KINE, PILATES]);
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
  const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement | null;
  if (campo === null) {
    throw new Error(`No existe el selector ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function abrir(fixture: { nativeElement: HTMLElement; detectChanges(): void }, etiqueta: string) {
  const boton = [...fixture.nativeElement.querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === etiqueta,
  );
  if (boton === undefined) {
    throw new Error(`No existe el boton ${etiqueta}`);
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
