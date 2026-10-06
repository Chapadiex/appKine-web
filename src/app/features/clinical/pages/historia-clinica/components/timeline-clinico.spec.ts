import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TimelineClinico } from './timeline-clinico';
import { provideApi } from '../../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../../core/interceptors/error.interceptor';

const HC = 88;
const TIMELINE = `/api/v1/historias-clinicas/${HC}/timeline`;
const CASOS = `/api/v1/historias-clinicas/${HC}/casos`;

function evento(referencia: number, titulo = 'Entrada clinica') {
  return {
    ocurrioEn: `2026-09-${String(30 - referencia).padStart(2, '0')}T12:00:00Z`,
    origen: 'ENTRADA_CLINICA',
    referencia,
    tipo: 'EVOLUCION',
    titulo,
  };
}

/**
 * El cursor del timeline (D-a). La pagina siguiente se pide con el cursor que trajo la anterior
 * —nunca con un numero de pagina— y se concatena; un cursor rechazado reinicia desde el principio
 * en vez de dejar la lista a medias.
 */
describe('TimelineClinico', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimelineClinico],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('la segunda pagina va con el cursor de la primera y se suma a la lista', async () => {
    const fixture = await montar();
    const primera = httpMock.expectOne((r) => r.url === TIMELINE);
    expect(primera.request.params.has('cursor')).toBe(false);
    primera.flush({ eventos: [evento(1), evento(2)], proximoCursor: 'c-1' });
    await estabilizar(fixture);
    expect(filas(fixture)).toBe(2);

    boton(fixture, 'Cargar hechos anteriores').click();
    const segunda = httpMock.expectOne((r: HttpRequest<unknown>) => r.url === TIMELINE);
    expect(segunda.request.params.get('cursor')).toBe('c-1');
    segunda.flush({ eventos: [evento(3)] });
    await estabilizar(fixture);

    expect(filas(fixture)).toBe(3);
    // Sin proximoCursor no hay mas: el boton desaparece y se dice por que.
    expect(botonOpcional(fixture, 'Cargar hechos anteriores')).toBeNull();
    expect(texto(fixture)).toContain('Ese es el primer hecho de la historia.');
  });

  it('un cursor rechazado reinicia desde la primera pagina', async () => {
    const fixture = await montar();
    httpMock
      .expectOne((r) => r.url === TIMELINE)
      .flush({ eventos: [evento(1)], proximoCursor: 'viejo' });
    await estabilizar(fixture);

    boton(fixture, 'Cargar hechos anteriores').click();
    httpMock
      .expectOne((r) => r.url === TIMELINE && r.params.get('cursor') === 'viejo')
      .flush(
        { type: 'https://akine.app/problems/cursor-invalido', status: 400 },
        { status: 400, statusText: 'Bad Request' },
      );
    await estabilizar(fixture);

    const reinicio = httpMock.expectOne((r) => r.url === TIMELINE);
    expect(reinicio.request.params.has('cursor')).toBe(false);
    reinicio.flush({ eventos: [evento(1), evento(2)] });
    await estabilizar(fixture);
    expect(filas(fixture)).toBe(2);
  });

  it('filtrar por caso lo resuelve el servidor y arranca de cero', async () => {
    const fixture = await montar([{ id: 7, numeroCaso: 1, estado: 'ACTIVO' }]);
    httpMock.expectOne((r) => r.url === TIMELINE).flush({ eventos: [evento(1), evento(2)] });
    await estabilizar(fixture);

    const selector = (fixture.nativeElement as HTMLElement).querySelector(
      '#timeline-caso',
    ) as HTMLSelectElement;
    selector.value = '7';
    selector.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const filtrada = httpMock.expectOne((r) => r.url === TIMELINE);
    expect(filtrada.request.params.get('casoId')).toBe('7');
    expect(filtrada.request.params.has('cursor')).toBe(false);
    filtrada.flush({ eventos: [] });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Este caso todavia no tiene hechos clinicos.');
  });

  async function montar(casos: object[] = []): Promise<ComponentFixture<TimelineClinico>> {
    const fixture = TestBed.createComponent(TimelineClinico);
    fixture.componentRef.setInput('historiaClinicaId', HC);
    fixture.componentRef.setInput('justificacion', null);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url === CASOS).flush(casos);
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<TimelineClinico>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function filas(fixture: ComponentFixture<TimelineClinico>): number {
    return (fixture.nativeElement as HTMLElement).querySelectorAll('.timeline__hecho').length;
  }

  function texto(fixture: ComponentFixture<TimelineClinico>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  function botonOpcional(
    fixture: ComponentFixture<TimelineClinico>,
    rotulo: string,
  ): HTMLButtonElement | null {
    const botones = (fixture.nativeElement as HTMLElement).querySelectorAll('button');
    return Array.from(botones).find((b) => b.textContent?.trim() === rotulo) ?? null;
  }

  function boton(fixture: ComponentFixture<TimelineClinico>, rotulo: string): HTMLButtonElement {
    const encontrado = botonOpcional(fixture, rotulo);
    if (encontrado === null) {
      throw new Error(`No hay boton "${rotulo}"`);
    }
    return encontrado;
  }
});
