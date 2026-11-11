import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';

import { ConsultaRequest } from '../../../../api/generated/model/consulta-request';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ConsultaApi, EventoConsulta } from '../../services/consulta-api';
import { ConsultaPage } from './consulta-page';

const eventos = (...e: EventoConsulta[]): Observable<EventoConsulta> => of(...e);
const FUENTE = { extracto: 'x', libroId: 1, paginaDesde: 2, paginaHasta: 2, titulo: 'Libro' };

describe('ConsultaPage', () => {
  let pedidos: ConsultaRequest[];
  let secuencia: () => Observable<EventoConsulta>;
  let fixture: ComponentFixture<ConsultaPage>;

  beforeEach(async () => {
    pedidos = [];
    secuencia = () => of();
    await TestBed.configureTestingModule({
      imports: [ConsultaPage],
      providers: [
        provideRouter([]),
        {
          provide: ConsultaApi,
          useValue: {
            consultar: (_org: number, pedido: ConsultaRequest) => {
              pedidos.push(pedido);
              return secuencia();
            },
          },
        },
        { provide: PermissionsStore, useValue: { tiene: () => false } },
      ],
    }).compileComponents();
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    fixture = TestBed.createComponent(ConsultaPage);
    fixture.detectChanges();
  });

  async function preguntar(texto: string): Promise<void> {
    const el = fixture.nativeElement as HTMLElement;
    const caja = el.querySelector('textarea') as HTMLTextAreaElement;
    caja.value = texto;
    caja.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el.querySelector('button[type=submit]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('streamingArmaLaRespuestaYLasFuentes', async () => {
    secuencia = () =>
      eventos(
        { tipo: 'fuentes', fuentes: [FUENTE, { ...FUENTE, libroId: 2 }] },
        { tipo: 'texto', texto: 'Hola' },
        { tipo: 'texto', texto: ' mundo' },
        { tipo: 'fin', sinMaterial: false, camino: 'x' },
      );
    await preguntar('¿qué?');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Hola mundo');
    expect(el.querySelector('summary')?.textContent).toContain('Fuentes (2)');
  });

  it('sinMaterialNoMuestraFuentes', async () => {
    secuencia = () =>
      eventos(
        { tipo: 'texto', texto: 'No encontré material en la biblioteca para responder eso.' },
        { tipo: 'fin', sinMaterial: true, camino: 'x' },
      );
    await preguntar('¿qué?');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Fuentes');
  });

  it('mandaComoMaximoSeisTurnos', async () => {
    secuencia = () =>
      eventos({ tipo: 'texto', texto: 'ok' }, { tipo: 'fin', sinMaterial: false, camino: 'x' });
    for (let i = 0; i < 5; i++) {
      await preguntar(`pregunta ${i}`);
    }
    expect(pedidos[3].historial?.length).toBe(6);
    expect(pedidos[4].historial?.length).toBe(6);
  });

  it('historialExcluyeSinMaterialYErrores', async () => {
    const ok = () =>
      eventos({ tipo: 'texto', texto: 'ok' }, { tipo: 'fin', sinMaterial: false, camino: 'x' });
    secuencia = () =>
      eventos({ tipo: 'texto', texto: 'nada' }, { tipo: 'fin', sinMaterial: true, camino: 'x' });
    await preguntar('sin material');
    secuencia = () => eventos({ tipo: 'error', type: 'x/asistente-no-disponible' });
    await preguntar('con error');
    secuencia = ok;
    await preguntar('buena');
    await preguntar('final');
    expect(pedidos[3].historial).toEqual([
      { rol: 'usuario', texto: 'buena' },
      { rol: 'asistente', texto: 'ok' },
    ]);
  });

  it('elModeloQueRespondeSinMaterialSeTrataComoSinMaterial', async () => {
    secuencia = () =>
      eventos(
        { tipo: 'fuentes', fuentes: [FUENTE] },
        { tipo: 'texto', texto: 'No encontré material en la biblioteca ' },
        { tipo: 'texto', texto: 'para responder eso.' },
        { tipo: 'fin', sinMaterial: false, camino: 'x' },
      );
    await preguntar('primera');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Fuentes');
    await preguntar('segunda');
    expect(pedidos[1].historial).toEqual([]);
  });

  it('elErrorConservaElTextoRecibido', async () => {
    secuencia = () =>
      eventos(
        { tipo: 'fuentes', fuentes: [FUENTE] },
        { tipo: 'texto', texto: 'Respuesta parcial' },
        { tipo: 'error', type: 'x/asistente-no-disponible' },
      );
    await preguntar('¿qué?');
    const texto = (fixture.nativeElement as HTMLElement).textContent;
    expect(texto).toContain('Respuesta parcial');
    expect(texto).toContain('El asistente no está disponible en este momento.');
  });

  it('conElTurnoDejaDeMostrarLaCola', async () => {
    const abierta = new Subject<EventoConsulta>();
    secuencia = () => abierta;
    await preguntar('hola');
    const el = fixture.nativeElement as HTMLElement;
    abierta.next({ tipo: 'espera', posicion: 1 });
    fixture.detectChanges();
    expect(el.textContent).toContain('En cola');
    abierta.next({ tipo: 'fuentes', fuentes: [FUENTE] });
    fixture.detectChanges();
    expect(el.textContent).not.toContain('En cola');
    expect(el.textContent).toContain('Buscando en la biblioteca…');
    abierta.next({ tipo: 'texto', texto: 'Hola' });
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Buscando en la biblioteca…');
  });

  it('cambiarDeCentroAbortaYVaciaLaCharla', async () => {
    const abierta = new Subject<EventoConsulta>();
    secuencia = () => abierta;
    await preguntar('hola');
    expect(abierta.observed).toBe(true);
    TestBed.inject(TenantContextStore).select({
      organizationId: 2,
      organizationName: 'Otro',
      consultorioId: 4,
      consultorioName: 'Sede 2',
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(abierta.observed).toBe(false);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('hola');
  });

  it('aclaracionMuestraBotonesYUnClicPregunta', async () => {
    secuencia = () =>
      eventos(
        { tipo: 'texto', texto: 'No encontré material en la biblioteca para responder eso.' },
        { tipo: 'fin', sinMaterial: true, camino: 'x' },
      );
    await preguntar('primera sin material');
    secuencia = () =>
      eventos(
        {
          tipo: 'aclaracion',
          texto: '¿Qué buscás sobre lumbalgia?',
          opciones: [
            { etiqueta: '¿Qué es lumbalgia?', pregunta: 'qué es lumbalgia' },
            { etiqueta: 'Ejercicios para lumbalgia', pregunta: 'ejercicios para lumbalgia' },
          ],
        },
        { tipo: 'fin', sinMaterial: false, camino: 'aclaracion' },
      );
    await preguntar('lumbalgia');
    const el = fixture.nativeElement as HTMLElement;
    const botones = Array.from(el.querySelectorAll('.consulta__opciones button'));
    expect(botones.map((b) => b.textContent?.trim())).toEqual([
      '¿Qué es lumbalgia?',
      'Ejercicios para lumbalgia',
    ]);
    secuencia = () => of();
    (botones[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(pedidos.at(-1)).toEqual({ pregunta: 'ejercicios para lumbalgia', historial: [] });
    expect(pedidos.at(-1)?.librosPreferidos).toBeUndefined();
  });

  it('etapaCambiaElEstado', async () => {
    const abierta = new Subject<EventoConsulta>();
    secuencia = () => abierta;
    await preguntar('hola');
    const el = fixture.nativeElement as HTMLElement;
    abierta.next({ tipo: 'espera', posicion: 2 });
    fixture.detectChanges();
    expect(el.textContent).toContain('En cola');
    abierta.next({ tipo: 'etapa', etapa: 'buscando' });
    fixture.detectChanges();
    expect(el.textContent).not.toContain('En cola');
    expect(el.textContent).toContain('Buscando en la biblioteca…');
    abierta.next({ tipo: 'etapa', etapa: 'redactando' });
    fixture.detectChanges();
    expect(el.textContent).toContain('Redactando…');
    expect(el.textContent).not.toContain('Buscando en la biblioteca…');
  });

  it('profundizarMandaElHistorialDeEsaRespuesta', async () => {
    const ok = () =>
      eventos(
        { tipo: 'fuentes', fuentes: [FUENTE, { ...FUENTE, libroId: 7 }, { ...FUENTE, libroId: 7 }] },
        { tipo: 'texto', texto: 'resp' },
        { tipo: 'fin', sinMaterial: false, camino: 'x' },
      );
    secuencia = ok;
    await preguntar('primera');
    await preguntar('segunda');
    const el = fixture.nativeElement as HTMLElement;
    const botones = el.querySelectorAll('.consulta__profundizar');
    expect(botones.length).toBe(2);
    (botones[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(pedidos.at(-1)).toEqual({
      pregunta: 'Más detalle sobre lo anterior',
      historial: [
        { rol: 'usuario', texto: 'primera' },
        { rol: 'asistente', texto: 'resp' },
      ],
      librosPreferidos: [1, 7],
    });
    // La respuesta profunda no ofrece profundizar otra vez.
    expect(el.querySelectorAll('.consulta__profundizar').length).toBe(2);
  });
});
