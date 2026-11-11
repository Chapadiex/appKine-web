import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

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
});
