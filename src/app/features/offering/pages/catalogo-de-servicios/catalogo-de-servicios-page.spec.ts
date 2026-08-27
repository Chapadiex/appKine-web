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

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const formulario = fixture.nativeElement.querySelector<HTMLFormElement>(selector);
  formulario?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
