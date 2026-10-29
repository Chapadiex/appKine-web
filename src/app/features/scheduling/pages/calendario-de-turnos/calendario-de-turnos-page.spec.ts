import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CalendarioDeTurnosPage } from './calendario-de-turnos-page';
import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { fijarReloj, soltarReloj } from '../../../../core/testing/reloj';

const CONSULTORIO = 3;
const ZONA = 'America/Argentina/Cordoba';
const calendario = (consultorio: number) => `/api/v1/consultorios/${consultorio}/turnos/calendario`;

/** Datos sinteticos. Sin nada clinico, porque la respuesta tampoco lo trae. */
const DE_LA_SEMANA = [
  {
    profesionalNombre: 'Lic. Paula Gómez',
    turno: {
      id: 501,
      estado: 'CONFIRMADO',
      // 01:30Z del martes: en Cordoba es el lunes a las 22:30.
      inicio: '2026-10-27T01:30:00Z',
      fin: '2026-10-27T02:15:00Z',
      personaNombre: 'Ramírez, Ana',
      documento: 'DNI 27888999',
      ofertaId: 42,
      ofertaNombre: 'Kinesiología deportiva',
      serieId: 7,
      version: 3,
    },
  },
  {
    turno: {
      id: 502,
      estado: 'RESERVADO',
      inicio: '2026-10-29T12:00:00Z',
      fin: '2026-10-29T12:45:00Z',
      personaNombre: 'Sosa, Bruno',
      ofertaId: 42,
      ofertaNombre: 'Kinesiología deportiva',
      version: 1,
    },
  },
];

/**
 * Spec del calendario semanal (DP-45). Cubre lo que decide comportamiento: la semana que se pide,
 * el reparto en el dia de la sede, el panel de detalle con su enlace al ciclo del turno, los
 * estados vacio y de error, y que un cambio de sede vacia y vuelve a pedir.
 */
describe('CalendarioDeTurnosPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CalendarioDeTurnosPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: CONSULTORIO,
      consultorioName: 'Sede Centro',
    });
  });

  afterEach(() => {
    soltarReloj();
    httpMock.verify();
  });

  it('pide la semana de lunes a lunes y reparte los turnos en el día de la sede', async () => {
    // Un miercoles cualquiera de la URL se normaliza a su lunes.
    const fixture = montar('2026-10-28');
    const pedido = httpMock.expectOne(esCalendario(CONSULTORIO));
    expect(pedido.request.params.get('desde')).toBe('2026-10-26');
    expect(pedido.request.params.get('hasta')).toBe('2026-11-02');
    pedido.flush({ timezone: ZONA, turnos: DE_LA_SEMANA });
    await asentar(fixture);

    const dias = Array.from(raiz(fixture).querySelectorAll('.calendario__dia'));
    expect(dias).toHaveLength(7);
    // El turno de las 01:30Z cae el LUNES, a las 22:30 de Cordoba.
    expect(dias[0].textContent).toContain('22:30');
    expect(dias[0].textContent).toContain('Ramírez, Ana');
    expect(dias[1].textContent).toContain('Sin turnos');
    expect(dias[3].textContent).toContain('Sosa, Bruno');
    expect(dias[3].textContent).toContain('09:00');
    expect(raiz(fixture).textContent).toContain('26 de octubre al 1 de noviembre de 2026');
  });

  it(
    'elegir un turno abre el detalle con el profesional y el enlace al ciclo del turno',
    async () => {
      const fixture = montar('2026-10-26');
      httpMock.expectOne(esCalendario(CONSULTORIO)).flush({ timezone: ZONA, turnos: DE_LA_SEMANA });
      await asentar(fixture);

      const boton = raiz(fixture).querySelector<HTMLButtonElement>('#calendario-turno-501');
      boton?.click();
      await asentar(fixture);

      const panel = raiz(fixture).querySelector('#calendario-detalle') as HTMLElement;
      expect(boton?.getAttribute('aria-expanded')).toBe('true');
      expect(panel.textContent).toContain('Lic. Paula Gómez');
      expect(panel.textContent).toContain('DNI 27888999');
      expect(panel.textContent).toContain('22:30 a 23:15');
      const verTurno = Array.from(panel.querySelectorAll('a')).find((a) =>
        (a.textContent ?? '').includes('Ver el turno'),
      );
      expect(verTurno?.getAttribute('href')).toBe(
        '/agenda/turnos/501?version=3&ofertaId=42&fecha=2026-10-26',
      );
      expect(panel.textContent).toContain('Ver la serie');
      // El foco va al panel; Escape lo cierra y devuelve el foco al turno.
      expect(document.activeElement?.id).toBe('calendario-detalle');

      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await asentar(fixture);
      expect(raiz(fixture).querySelector('#calendario-detalle')).toBeNull();
      expect(document.activeElement?.id).toBe('calendario-turno-501');

      boton?.click();
      await asentar(fixture);
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  it('sin turnos muestra el vacío y no la grilla', async () => {
    const fixture = montar('2026-10-26');
    httpMock.expectOne(esCalendario(CONSULTORIO)).flush({ timezone: ZONA, turnos: [] });
    await asentar(fixture);

    // UX-14: el vacio es `app-estado-vacio`, no un parrafo suelto.
    expect(raiz(fixture).querySelector('app-estado-vacio')?.textContent).toContain(
      'Esta semana no tiene turnos reservados',
    );
    expect(raiz(fixture).querySelector('.calendario__semana')).toBeNull();
  });

  it('un error se explica en el lugar y "Reintentar" vuelve a pedir la misma semana', async () => {
    const fixture = montar('2026-10-26');
    httpMock
      .expectOne(esCalendario(CONSULTORIO))
      .flush(null, { status: 0, statusText: 'Unknown Error' });
    await asentar(fixture);

    expect(raiz(fixture).querySelector('app-alerta')?.textContent).toContain(
      'No pudimos leer los turnos de la semana',
    );
    botonQueDice(fixture, 'Reintentar').click();
    const reintento = httpMock.expectOne(esCalendario(CONSULTORIO));
    expect(reintento.request.params.get('desde')).toBe('2026-10-26');
    reintento.flush({ timezone: ZONA, turnos: DE_LA_SEMANA });
    await asentar(fixture);

    expect(raiz(fixture).textContent).not.toContain('No pudimos leer');
    expect(raiz(fixture).textContent).toContain('Ramírez, Ana');
  });

  it('semana siguiente pide la otra semana y cambiar de sede vacía y vuelve a pedir', async () => {
    const fixture = montar('2026-10-26');
    httpMock.expectOne(esCalendario(CONSULTORIO)).flush({ timezone: ZONA, turnos: DE_LA_SEMANA });
    await asentar(fixture);

    botonQueDice(fixture, 'Semana siguiente').click();
    const siguiente = httpMock.expectOne(esCalendario(CONSULTORIO));
    expect(siguiente.request.params.get('desde')).toBe('2026-11-02');
    siguiente.flush({ timezone: ZONA, turnos: DE_LA_SEMANA });
    await asentar(fixture);

    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 9,
      consultorioName: 'Sede Norte',
    });
    fixture.detectChanges();
    // Mientras carga no queda nada de la sede anterior en pantalla.
    expect(raiz(fixture).textContent).not.toContain('Ramírez, Ana');
    const deLaOtraSede = httpMock.expectOne(esCalendario(9));
    // La semana elegida se conserva al cambiar de sede.
    expect(deLaOtraSede.request.params.get('desde')).toBe('2026-11-02');
    deLaOtraSede.flush({ timezone: ZONA, turnos: [] });
    await asentar(fixture);
    expect(raiz(fixture).textContent).toContain('Esta semana no tiene turnos reservados');
  });

  it('sin semana en la URL abre en la semana de HOY en la sede, no en la del navegador', async () => {
    // Lunes 02/11 a la 01:00 en UTC es domingo 01/11 a las 22:00 en Cordoba: otra semana.
    fijarReloj('2026-11-02T01:00:00Z', { navegadorEnUtc: true });
    const fixture = montar('');

    const provisoria = httpMock.expectOne(esCalendario(CONSULTORIO));
    expect(provisoria.request.params.get('desde')).toBe('2026-11-02');
    provisoria.flush({ timezone: ZONA, turnos: [] });

    const deLaSede = httpMock.expectOne(esCalendario(CONSULTORIO));
    expect(deLaSede.request.params.get('desde')).toBe('2026-10-26');
    deLaSede.flush({ timezone: ZONA, turnos: DE_LA_SEMANA });
    await asentar(fixture);

    const hoy = raiz(fixture).querySelector('[aria-current="date"]');
    expect(hoy?.textContent).toContain('domingo, 1 de noviembre');
  });

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  function montar(semana: string): ComponentFixture<CalendarioDeTurnosPage> {
    const fixture = TestBed.createComponent(CalendarioDeTurnosPage);
    fixture.componentRef.setInput('semana', semana);
    fixture.detectChanges();
    return fixture;
  }

  async function asentar(fixture: ComponentFixture<CalendarioDeTurnosPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function raiz(fixture: ComponentFixture<CalendarioDeTurnosPage>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function esCalendario(consultorio: number): (p: HttpRequest<unknown>) => boolean {
    return (p) => p.method === 'GET' && p.url === calendario(consultorio);
  }

  function botonQueDice(
    fixture: ComponentFixture<CalendarioDeTurnosPage>,
    texto: string,
  ): HTMLButtonElement {
    const boton = Array.from(raiz(fixture).querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes(texto),
    );
    expect(boton, `no se encontro el boton "${texto}"`).toBeDefined();
    return boton as HTMLButtonElement;
  }
});
