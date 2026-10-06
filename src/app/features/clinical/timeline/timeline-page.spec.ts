import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TimelinePage } from './timeline-page';
import { TimelineApi } from './timeline-api';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { provideApi } from '../../../api/generated/provide-api';

const PERSONA = 42;
const HC = 9;
const POR_PERSONA = `/api/v1/historias-clinicas/por-persona/${PERSONA}`;
const TIMELINE = `/api/v1/historias-clinicas/${HC}/timeline`;
const ADJUNTOS = `/api/v1/historias-clinicas/${HC}/adjuntos`;

describe('TimelinePage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelinePage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => httpMock.verify());

  function montar() {
    const fixture = TestBed.createComponent(TimelinePage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();
    return fixture;
  }

  const esTimeline = (r: { url: string }) => r.url.startsWith(TIMELINE);
  const esAdjuntos = (r: { url: string }) => r.url.startsWith(ADJUNTOS);

  it('abre la HC, lista los eventos en el orden del backend y pagina por cursor', async () => {
    const fixture = montar();
    httpMock
      .expectOne(POR_PERSONA)
      .flush({ id: HC, personaId: PERSONA, personaNombreCompleto: 'Ana Perez' });
    const primera = httpMock.expectOne(esTimeline);
    expect(primera.request.params.has('cursor')).toBe(false);
    primera.flush({
      eventos: [
        { titulo: 'Segundo', tipo: 'ENTRADA', referencia: 2 },
        { titulo: 'Primero', tipo: 'ENTRADA', referencia: 1 },
      ],
      proximoCursor: 'abc',
    });
    httpMock.expectOne(esAdjuntos).flush({ content: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    const titulos = Array.from(el.querySelectorAll('li h2')).map((h) => h.textContent?.trim());
    expect(titulos).toEqual(['Segundo', 'Primero']);
    expect(el.textContent).toContain('Ana Perez');

    const boton = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Ver mas'),
    ) as HTMLButtonElement;
    boton.click();
    const segunda = httpMock.expectOne(esTimeline);
    expect(segunda.request.params.get('cursor')).toBe('abc');
    segunda.flush({ eventos: [{ titulo: 'Tercero', tipo: 'ENTRADA' }] });
    await fixture.whenStable();
    fixture.detectChanges();

    const todos = Array.from(el.querySelectorAll('li h2')).map((h) => h.textContent?.trim());
    expect(todos).toEqual(['Segundo', 'Primero', 'Tercero']);
    expect(el.textContent).not.toContain('Ver mas');
  });

  it('muestra los adjuntos de cada entrada', async () => {
    const fixture = montar();
    httpMock.expectOne(POR_PERSONA).flush({ id: HC });
    httpMock.expectOne(esTimeline).flush({
      eventos: [
        { titulo: 'Con estudio', referencia: 5 },
        { titulo: 'Sin nada', referencia: 6 },
      ],
    });
    httpMock.expectOne(esAdjuntos).flush({
      content: [{ id: 1, entradaClinicaId: 5, titulo: 'Radiografia', contentType: 'image/png' }],
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Radiografia');
    expect(el.querySelectorAll('ul[aria-label="Adjuntos"]').length).toBe(1);
  });

  it('traduce un 403 sin filtrar el detalle del backend', async () => {
    const fixture = montar();
    httpMock
      .expectOne(POR_PERSONA)
      .flush({ status: 403, detail: 'interno' }, { status: 403, statusText: 'Forbidden' });
    await fixture.whenStable();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('No tenes permiso');
    expect(el.textContent).not.toContain('interno');
  });

  it('indica cuando la HC no tiene eventos', async () => {
    const fixture = montar();
    httpMock.expectOne(POR_PERSONA).flush({ id: HC });
    httpMock.expectOne(esTimeline).flush({ eventos: [] });
    httpMock.expectOne(esAdjuntos).flush({ content: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Todavia no hay eventos');
  });
});

describe('TimelineApi', () => {
  let httpMock: HttpTestingController;
  let api: TimelineApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    api = TestBed.inject(TimelineApi);
  });

  afterEach(() => httpMock.verify());

  it('pide el timeline con el cursor y el limite', () => {
    api.verTimeline(HC, 'xyz').subscribe();
    const req = httpMock.expectOne(esTimelineUrl);
    expect(req.request.params.get('cursor')).toBe('xyz');
    expect(req.request.params.get('limite')).toBe('20');
    req.flush({});
  });

  it('descarga el adjunto como binario', () => {
    let recibido: Blob | undefined;
    api.descargar(HC, 4).subscribe((b) => (recibido = b));
    const req = httpMock.expectOne(`${ADJUNTOS}/4/contenido`);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
    expect(recibido).toBeInstanceOf(Blob);
  });

  function esTimelineUrl(r: { url: string }): boolean {
    return r.url.startsWith(TIMELINE);
  }
});
