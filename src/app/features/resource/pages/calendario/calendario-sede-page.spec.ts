import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CalendarioSedePage } from './calendario-sede-page';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS, rutaCalendarioSede } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const ORG = 1;
const SEDE = 3;
const CALENDARIO = rutaCalendarioSede(SEDE);

const FERIADOS = [
  { id: 9, fecha: '2026-09-10', nombre: 'Dia del maestro', pais: 'AR', tipo: 'INAMOVIBLE' },
  { id: 10, fecha: '2026-12-25', nombre: 'Navidad', pais: 'AR', tipo: 'INAMOVIBLE' },
];

const POLITICA = {
  consultorioId: SEDE,
  pais: 'AR',
  cierraPorFeriado: true,
  existePersistida: true,
  feriados: FERIADOS,
  version: 4,
};

/**
 * Spec del calendario de la sede (M05, AKINE-02.04).
 *
 * <p>Cubre las dos cosas que se rompen sin dar error:
 *
 * <ol>
 *   <li>Que apagar el interruptor <b>diga que implica</b>. Un switch pelado deja al
 *       administrador creyendo que desactivo algo menor cuando en realidad abrio todos los
 *       feriados del calendario para todos los profesionales de la sede.</li>
 *   <li>Que la respuesta del `PUT` —que trae la lista de feriados VACIA porque no tiene
 *       ventana— <b>no pise</b> la lista que ya estaba. Si la pisara, la pantalla se quedaria
 *       sin feriados justo despues de tocar la politica que los rige, y eso se lee como "esta
 *       sede no tiene feriados".</li>
 * </ol>
 */
describe('CalendarioSedePage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarioSedePage],
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

  it('muestra la politica vigente y los feriados del periodo', async () => {
    const fixture = await montar();
    const contenido = texto(fixture);

    expect(contenido).toContain('Calendario nacional en uso:');
    expect(contenido).toContain('AR');
    expect(contenido).toContain('10 de septiembre de 2026');
    expect(contenido).toContain('Dia del maestro');
    expect(contenido).toContain('Navidad');

    // Con la politica de cerrar puesta, la consecuencia de apagarla NO se muestra todavia.
    expect(casilla(fixture).checked).toBe(true);
    expect(contenido).not.toContain('La sede pasa a atender los feriados');
  });

  it('apagar el interruptor dice que la sede pasa a atender los feriados', async () => {
    const fixture = await montar();

    marcar(fixture, false);

    // La consecuencia se dice ANTES de guardar: es lo unico que permite decidir con
    // conocimiento, y el cambio alcanza a todos los feriados y a todos los profesionales.
    const antes = texto(fixture);
    expect(antes).toContain('La sede pasa a atender los feriados');
    expect(antes).toContain('salvo que exista un');
    expect(antes).toContain('cierre explicito');
    expect(antes).toContain('tambien para los que ya pasaron');
    // Y ofrece la alternativa correcta para el caso frecuente: abrir UN feriado puntual.
    expect(antes).toContain('carga una apertura de sede para ese dia');
    expect(antes).toContain('Hay un cambio sin guardar');

    // Nada salio a la red todavia: apagar la casilla no guarda.
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'PUT');

    enviar(fixture, '#form-politica');

    const guardado = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT' && peticion.url === CALENDARIO,
    );
    // Solo el flag. Mandar `pais` de paso convertiria un cambio de politica en un cambio de
    // calendario nacional, porque el PUT tiene semantica de PATCH: lo omitido queda como estaba.
    expect(guardado.request.body).toEqual({ cierraPorFeriado: false });

    // La respuesta del PUT trae la lista VACIA porque el PUT no tiene ventana.
    guardado.flush({
      consultorioId: SEDE,
      pais: 'AR',
      cierraPorFeriado: false,
      existePersistida: true,
      feriados: [],
      version: 5,
    });
    await estabilizar(fixture);

    const despues = texto(fixture);
    expect(despues).toContain('la sede pasa a atender los feriados');
    // Vacia significa "no se pregunto", nunca "no hay feriados": la lista que ya estaba sigue.
    expect(despues).toContain('Dia del maestro');
    expect(despues).toContain('son informativos');
    expect(despues).not.toContain('Hay un cambio sin guardar');
  });

  it('volver a encenderlo lo dice con las mismas palabras y sin rodeos', async () => {
    const fixture = await montar({ ...POLITICA, cierraPorFeriado: false });

    expect(casilla(fixture).checked).toBe(false);
    expect(texto(fixture)).toContain('La sede pasa a atender los feriados');

    marcar(fixture, true);
    enviar(fixture, '#form-politica');

    const guardado = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'PUT' && peticion.url === CALENDARIO,
    );
    expect(guardado.request.body).toEqual({ cierraPorFeriado: true });

    guardado.flush({ ...POLITICA, feriados: [], version: 5 });
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('vuelve a cerrar los feriados');
  });

  /**
   * Una sede sin fila propia no es una sede sin politica.
   *
   * <p>La lectura no crea la fila —un GET que escribe es una mutacion que nadie pidio—, asi que
   * `existePersistida: false` significa que nadie la edito nunca y lo que se ve es el default.
   */
  it('una sede que nunca edito su politica lo dice, y su default es cerrar', async () => {
    const fixture = await montar({
      consultorioId: SEDE,
      pais: 'AR',
      existePersistida: false,
      feriados: [],
      version: 0,
    });

    expect(texto(fixture)).toContain('Nadie edito nunca la politica de esta sede');
    // Sin `cierraPorFeriado` en la respuesta, la casilla queda marcada: lo conservador es cerrar.
    expect(casilla(fixture).checked).toBe(true);
    expect(texto(fixture)).toContain('No hay feriados del calendario nacional');
  });

  it('si el guardado falla lo dice y no cambia lo que muestra la lista', async () => {
    const fixture = await montar();

    marcar(fixture, false);
    enviar(fixture, '#form-politica');

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.method === 'PUT')
      .flush(
        { type: 'https://akine.app/problems/consultorio-inactive' },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('La sede esta dada de baja');
    expect(texto(fixture)).toContain('Dia del maestro');
  });

  it('una ventana invertida o mas larga que el tope no sale a la red', async () => {
    const fixture = await montar();

    escribir(fixture, '#calendario-hasta', '2020-01-01');
    enviar(fixture, '#form-ventana');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'GET');
    expect(texto(fixture)).toContain('tiene que ser posterior al inicio');

    escribir(fixture, '#calendario-desde', '2026-01-01');
    escribir(fixture, '#calendario-hasta', '2030-01-01');
    enviar(fixture, '#form-ventana');
    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.method === 'GET');
    expect(texto(fixture)).toContain('no puede superar los 366 dias');

    // Una ventana valida si consulta, y con las fechas que se escribieron.
    escribir(fixture, '#calendario-hasta', '2026-06-01');
    enviar(fixture, '#form-ventana');
    const consulta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'GET' && peticion.url === CALENDARIO,
    );
    expect(consulta.request.params.get('desde')).toBe('2026-01-01');
    expect(consulta.request.params.get('hasta')).toBe('2026-06-01');
    consulta.flush({ ...POLITICA, feriados: [] });
    await estabilizar(fixture);
  });

  it('un error de lectura se puede reintentar sin recargar la pagina', async () => {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });

    const fixture = TestBed.createComponent(CalendarioSedePage);
    fixture.detectChanges();

    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === CALENDARIO)
      .flush(
        {
          type: 'https://akine.app/problems/server-error',
          detail: 'No se pudo leer el calendario de la sede',
        },
        { status: 500, statusText: 'X' },
      );
    await estabilizar(fixture);

    // Con cuerpo de Problem Details gana la prosa del backend, que nombra el hecho concreto.
    expect(texto(fixture)).toContain('No se pudo leer el calendario de la sede');

    abrir(fixture, 'Reintentar');
    httpMock
      .expectOne((peticion: HttpRequest<unknown>) => peticion.url === CALENDARIO)
      .flush(POLITICA);
    await estabilizar(fixture);

    // Sin `consultorio:manage` se puede mirar, pero no se ofrece guardar: seria un 403 seguro.
    expect(texto(fixture)).toContain('Dia del maestro');
    expect(texto(fixture)).not.toContain('Guardar la politica');
  });

  it('sin sede elegida no consulta nada y ofrece elegir consultorio', async () => {
    tenantContext.select({ organizationId: ORG, organizationName: 'Belgrano' });

    const fixture = TestBed.createComponent(CalendarioSedePage);
    fixture.detectChanges();
    await estabilizar(fixture);

    httpMock.expectNone((peticion: HttpRequest<unknown>) => peticion.url === CALENDARIO);
    httpMock.match(RUTA_PERMISOS_EFECTIVOS).forEach((p) => p.flush({ permissions: [] }));

    const contenido = texto(fixture);
    expect(contenido).toContain('Todavia no elegiste un consultorio');
    expect(contenido).toContain('Tu sesion sigue abierta');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
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
    politica: Record<string, unknown> = POLITICA,
  ): Promise<ComponentFixture<CalendarioSedePage>> {
    tenantContext.select({
      organizationId: ORG,
      organizationName: 'Belgrano',
      consultorioId: SEDE,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock
      .expectOne(RUTA_PERMISOS_EFECTIVOS)
      .flush({ permissions: [PERMISO_CONSULTORIO_MANAGE] });

    const fixture = TestBed.createComponent(CalendarioSedePage);
    fixture.detectChanges();

    httpMock
      .expectOne(
        (peticion: HttpRequest<unknown>) =>
          peticion.method === 'GET' && peticion.url === CALENDARIO,
      )
      .flush(politica);
    await estabilizar(fixture);

    return fixture;
  }

  function casilla(fixture: ComponentFixture<CalendarioSedePage>): HTMLInputElement {
    const raiz = fixture.nativeElement as HTMLElement;
    const control = raiz.querySelector<HTMLInputElement>('#calendario-cierra');
    if (control === null) {
      throw new Error('No existe la casilla de la politica');
    }
    return control;
  }

  function marcar(fixture: ComponentFixture<CalendarioSedePage>, valor: boolean): void {
    const control = casilla(fixture);
    control.checked = valor;
    control.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }
});

async function estabilizar(fixture: ComponentFixture<CalendarioSedePage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
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
