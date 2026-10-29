import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuditPage } from './audit-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const VACIA = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };

/**
 * Spec de la consulta de auditoria (M24, AKINE-01.03).
 *
 * <p>Lo unico que esta pantalla tiene de particular es que el backend exige <b>exactamente
 * uno</b> de tres filtros. Se prueba que la interfaz lo haga imposible por construccion —que
 * cambiar de filtro no arrastre los campos del anterior— y que la ventana de mas de 90 dias
 * ni siquiera salga a la red. Los estados de carga y error son los mismos de las otras
 * pantallas y ya estan cubiertos alla.
 */
describe('AuditPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
  });

  afterEach(() => httpMock.verify());

  it('manda solo el filtro elegido, sin arrastrar los campos del anterior', async () => {
    const fixture = montar();

    // Se llena el filtro de entidad y despues se cambia de idea: los campos del primero
    // siguen en el formulario pero no pueden viajar, porque combinarlos es un 400.
    escribir(fixture, '#auditoria-entityType', 'MEMBERSHIP');
    escribir(fixture, '#auditoria-entityId', '10');
    marcar(fixture, '#auditoria-filtro-actor');
    escribir(fixture, '#auditoria-actorAccountId', '18');
    buscar(fixture);

    const peticion = httpMock.expectOne(esConsulta());
    const parametros = peticion.request.params;

    expect(parametros.get('actorAccountId')).toBe('18');
    expect(parametros.has('entityType')).toBe(false);
    expect(parametros.has('entityId')).toBe(false);
    expect(parametros.has('from')).toBe(false);

    peticion.flush(VACIA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No hay hechos registrados');

    // UX-14: el total va en la toolbar y el vacio con filtro ofrece limpiarlo.
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector('.filtros-barra__resultados')?.textContent?.trim()).toBe('0 hechos');
    [...host.querySelectorAll<HTMLButtonElement>('app-estado-vacio button')]
      .find((boton) => boton.textContent?.includes('Limpiar filtros'))!
      .click();
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Elegí un filtro y presiona Buscar.');
    expect(host.querySelector<HTMLInputElement>('#auditoria-filtro-entidad')!.checked).toBe(true);
  });

  it('una ventana de mas de 90 días no sale a la red', () => {
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-ventana');
    escribir(fixture, '#auditoria-desde', '2026-01-01');
    escribir(fixture, '#auditoria-hasta', '2026-06-30');
    buscar(fixture);

    // El backend la rechazaria igual: el punto es que el usuario vea el limite en el campo
    // que lo causa y no gaste un rechazo del servidor para enterarse.
    httpMock.expectNone(esConsulta());
    expect(texto(fixture)).toContain('no puede superar los 90 días');
  });

  it('elegir un hecho abre su detalle en un panel, mueve el foco y Escape lo cierra', async () => {
    const fixture = montar();
    escribir(fixture, '#auditoria-entityType', 'MEMBERSHIP');
    escribir(fixture, '#auditoria-entityId', '10');
    buscar(fixture);
    httpMock.expectOne(esConsulta()).flush({
      content: [
        {
          id: 77,
          occurredAt: '2026-10-01T12:00:00Z',
          eventType: 'MEMBERSHIP_ROLE_CHANGED',
          entityType: 'MEMBERSHIP',
          entityId: 10,
          actorAccountId: 5,
          previousState: 'ADMINISTRATIVO',
          newState: 'PROFESIONAL',
          reason: 'Pasa a atender',
          correlationId: 'corr-1',
          details: { origen: 'pantalla' },
        },
      ],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    // UX-14: pie estandar debajo de la tabla.
    expect(texto(fixture)).toContain('Mostrando 1–1 de 1');
    const disparador = host.querySelector<HTMLButtonElement>('#auditoria-evento-77')!;
    const panel = host.querySelector<HTMLElement>('#auditoria-detalle')!;
    expect(disparador.getAttribute('aria-expanded')).toBe('false');
    expect(disparador.getAttribute('aria-controls')).toBe('auditoria-detalle');
    expect(panel.hidden).toBe(true);

    disparador.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(disparador.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain('MEMBERSHIP_ROLE_CHANGED');
    expect(panel.textContent).toContain('Pasa a atender');
    expect(panel.textContent).toContain('corr-1');
    expect(panel.textContent).toContain('origen');
    expect(document.activeElement).toBe(panel);

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(panel.hidden).toBe(true);
    expect(disparador.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(disparador);
  });

  it('un 403 por falta de permiso muestra el rechazo y NO ofrece elegir contexto', async () => {
    // Un 403 de permiso y uno de contexto se resuelven de formas opuestas: el primero se pide,
    // el segundo se elige. Ofrecer el selector de contexto aca manda al usuario a dar vueltas
    // por una pantalla que no le va a cambiar nada.
    const fixture = montar();

    escribir(fixture, '#auditoria-entityType', 'MEMBERSHIP');
    escribir(fixture, '#auditoria-entityId', '10');
    buscar(fixture);

    httpMock
      .expectOne(esConsulta())
      .flush(
        { title: 'Prohibido', detail: 'No tenés auditoria:read sobre esta sede.' },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No tenés auditoria:read sobre esta sede.');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).toBeNull();
  });

  it('un 403 de contexto faltante si ofrece elegir contexto', async () => {
    // La lectura de auditoria es sensible -incluye los accesos clinicos-, asi que el backend
    // corta antes de resolver el tenant. La unica salida es elegir contexto, y sin el enlace el
    // usuario se queda mirando un error que no puede resolver desde ahi.
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-actor');
    escribir(fixture, '#auditoria-actorAccountId', '18');
    buscar(fixture);

    httpMock
      .expectOne(esConsulta())
      .flush(
        { type: 'https://akine.app/problems/missing-tenant-context' },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Todavía no elegiste un contexto de trabajo.');
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  it('un 429 dice cuantos segundos esperar en vez de un "demasiados intentos" pelado', async () => {
    // Sin el plazo el usuario reintenta a ciegas y se come otro rechazo, que en auditoria
    // ademas queda registrado.
    const fixture = montar();

    escribir(fixture, '#auditoria-entityType', 'MEMBERSHIP');
    escribir(fixture, '#auditoria-entityId', '10');
    buscar(fixture);

    httpMock
      .expectOne(esConsulta())
      .flush(
        { type: 'https://akine.app/problems/rate-limited' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '45' } },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Espera 45 segundos');
  });

  it('un error de red se distingue de un rechazo del servidor', async () => {
    // "Revisa tu conexion" y "no tenes permiso" mandan a hacer cosas distintas: sin la
    // distincion, un corte de red se reporta como un problema de permisos.
    const fixture = montar();

    escribir(fixture, '#auditoria-entityType', 'MEMBERSHIP');
    escribir(fixture, '#auditoria-entityId', '10');
    buscar(fixture);

    httpMock.expectOne(esConsulta()).error(new ProgressEvent('error'), { status: 0 });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Revisa tu conexion');
  });

  it('el filtro de entidad a medio llenar no sale a la red y marca el campo que falta', () => {
    // El backend responde 400 igual, pero el rechazo no dice cual de los dos campos faltaba:
    // gastarlo para averiguarlo deja al usuario adivinando.
    const fixture = montar();

    buscar(fixture);
    httpMock.expectNone(esConsulta());
    expect(texto(fixture)).toContain('Indica el tipo de entidad.');

    escribir(fixture, '#auditoria-entityType', 'MEMBERSHIP');
    buscar(fixture);
    httpMock.expectNone(esConsulta());
    expect(texto(fixture)).toContain('Indica el número de la entidad.');
  });

  it('el filtro por actor sin número de cuenta tampoco sale a la red', () => {
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-actor');
    buscar(fixture);

    httpMock.expectNone(esConsulta());
    expect(texto(fixture)).toContain('Indica la cuenta cuya actividad queres ver.');
  });

  it('una ventana con una sola fecha no sale a la red', () => {
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-ventana');
    escribir(fixture, '#auditoria-desde', '2026-01-01');
    buscar(fixture);

    httpMock.expectNone(esConsulta());
    expect(texto(fixture)).toContain('Indica las dos fechas de la ventana.');
  });

  it('una ventana invertida no sale a la red', () => {
    // Un rango al reves devuelve cero hechos sin decir por que: se lee como "no paso nada",
    // que es justo la conclusion equivocada en una consulta de auditoria.
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-ventana');
    escribir(fixture, '#auditoria-desde', '2026-06-30');
    escribir(fixture, '#auditoria-hasta', '2026-01-01');
    buscar(fixture);

    httpMock.expectNone(esConsulta());
    expect(texto(fixture)).toContain('posterior a la inicial');
  });

  it('una ventana de exactamente 90 días SI sale a la red, con el día final entero', () => {
    // El borde del tope. Si la comparacion se pasa de estricta, el usuario no puede pedir la
    // ventana maxima que la propia pantalla le promete.
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-ventana');
    escribir(fixture, '#auditoria-desde', '2026-01-01');
    escribir(fixture, '#auditoria-hasta', '2026-03-31');
    buscar(fixture);

    // Los dos puntos viajan escapados: `HttpParams` los codifica, y el backend los acepta asi.
    const peticion = httpMock.expectOne(esConsulta());
    expect(decodeURIComponent(peticion.request.params.get('from') ?? '')).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    // El dia final se incluye entero: quien elige el 31 espera ver lo que paso ese dia.
    expect(decodeURIComponent(peticion.request.params.get('to') ?? '')).toBe(
      '2026-03-31T23:59:59.000Z',
    );

    peticion.flush(VACIA);
  });

  it('cambiar de filtro borra el error que dejo el anterior', () => {
    // Un cartel de "la ventana no puede superar los 90 dias" sobre el filtro por actor no
    // describe nada de lo que hay en pantalla.
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-ventana');
    escribir(fixture, '#auditoria-desde', '2026-01-01');
    escribir(fixture, '#auditoria-hasta', '2026-06-30');
    buscar(fixture);
    expect(texto(fixture)).toContain('no puede superar los 90 días');

    marcar(fixture, '#auditoria-filtro-actor');

    expect(texto(fixture)).not.toContain('no puede superar los 90 días');
    // Y los intentos vuelven a cero: el campo del filtro nuevo no nace en rojo.
    expect(texto(fixture)).not.toContain('Indica la cuenta cuya actividad queres ver.');
  });

  it('pasar de página conserva el filtro elegido y pide la página siguiente', async () => {
    // Si la paginacion rearmara los parametros desde cero, la pagina 2 vendria de otra
    // consulta y el usuario estaria leyendo hechos que no pidio.
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-actor');
    escribir(fixture, '#auditoria-actorAccountId', '18');
    buscar(fixture);

    httpMock.expectOne(esConsulta()).flush({
      content: [{ id: 1, occurredAt: '2026-09-01T10:00:00Z', eventType: 'MEMBERSHIP_CREATED' }],
      page: 0,
      size: 20,
      totalElements: 30,
      totalPages: 2,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const siguiente = [...fixture.nativeElement.querySelectorAll('button')].find(
      (boton: HTMLButtonElement) => (boton.textContent ?? '').includes('Página siguiente'),
    ) as HTMLButtonElement | undefined;
    siguiente?.click();
    fixture.detectChanges();

    const segunda = httpMock.expectOne(esConsulta());
    expect(segunda.request.params.get('page')).toBe('1');
    expect(segunda.request.params.get('actorAccountId')).toBe('18');

    segunda.flush(VACIA);
  });

  it('el texto refina el filtro elegido y ordenar una columna relee desde la primera página', async () => {
    const fixture = montar();
    marcar(fixture, '#auditoria-filtro-actor');
    escribir(fixture, '#auditoria-actorAccountId', '18');
    escribir(fixture, '#auditoria-q', ' membership ');
    buscar(fixture);

    const primera = httpMock.expectOne(esConsulta());
    expect(primera.request.params.get('q')).toBe('membership');
    expect(primera.request.params.has('sort')).toBe(false);
    primera.flush({
      content: [{ id: 1, occurredAt: '2026-09-01T10:00:00Z', eventType: 'MEMBERSHIP_CREATED' }],
      page: 0,
      size: 20,
      totalElements: 30,
      totalPages: 2,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const hecho = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('th[appOrdenable]'),
    ].find((th) => th.textContent?.includes('Hecho'))!;
    hecho.querySelector('button')!.click();

    const ordenada = httpMock.expectOne(esConsulta());
    expect(decodeURIComponent(ordenada.request.params.get('sort')!)).toBe('tipoEvento,asc');
    expect(ordenada.request.params.get('page')).toBe('0');
    expect(ordenada.request.params.get('actorAccountId')).toBe('18');
    expect(ordenada.request.params.get('q')).toBe('membership');
    ordenada.flush(VACIA);
  });

  it('sin contexto elegido, Buscar no gasta un rechazo del servidor', () => {
    // La pantalla es alcanzable sin contexto, y la consulta sin organizacion no existe.
    const fixture = TestBed.createComponent(AuditPage);
    fixture.detectChanges();

    escribir(fixture, '#auditoria-entityType', 'MEMBERSHIP');
    escribir(fixture, '#auditoria-entityId', '10');
    buscar(fixture);

    httpMock.expectNone(() => true);
    expect(texto(fixture)).toContain('Todavía no elegiste un contexto de trabajo.');
  });

  it('cambiar de organización descarta los hechos de la anterior', async () => {
    // Son hechos auditados de OTRO tenant: dejarlos en pantalla bajo el nombre de la nueva
    // organizacion es una fuga de datos entre tenants, aunque nadie vuelva a consultarlos.
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-actor');
    escribir(fixture, '#auditoria-actorAccountId', '18');
    buscar(fixture);

    httpMock.expectOne(esConsulta()).flush({
      content: [{ id: 1, occurredAt: '2026-09-01T10:00:00Z', eventType: 'MEMBERSHIP_REVOKED' }],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(texto(fixture)).toContain('MEMBERSHIP_REVOKED');

    tenantContext.select({ organizationId: 2, organizationName: 'Nueva Cordoba' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).not.toContain('MEMBERSHIP_REVOKED');
    expect(texto(fixture)).toContain('Elegí un filtro y presiona Buscar.');
  });

  it(
    'no tiene violaciones de axe con el filtro de ventana temporal abierto',
    async () => {
      const fixture = montar();
      marcar(fixture, '#auditoria-filtro-ventana');

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  function montar() {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano', consultorioId: 3 });

    const fixture = TestBed.createComponent(AuditPage);
    fixture.detectChanges();

    // Arranca sin consultar nada: sin ninguno de los tres filtros la peticion es invalida.
    httpMock.expectNone(() => true);

    return fixture;
  }
});

function esConsulta() {
  return (peticion: HttpRequest<unknown>) =>
    peticion.url === '/api/v1/organizations/1/audit-events';
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
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

function marcar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const radio = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (radio === null) {
    throw new Error(`No existe el radio ${selector}`);
  }
  radio.click();
  fixture.detectChanges();
}

function buscar(fixture: { nativeElement: HTMLElement; detectChanges(): void }) {
  fixture.nativeElement.querySelector('form')?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
