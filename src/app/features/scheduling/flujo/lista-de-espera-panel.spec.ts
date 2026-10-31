import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../api/generated/provide-api';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import { ContextoDeTurno } from '../../../core/models/contexto-de-turno';
import { AvisosStore } from '../../../core/services/avisos.store';
import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';
import { fijarReloj, soltarReloj } from '../../../core/testing/reloj';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../core/testing/rutas-api';
import { ListaDeEsperaPanel } from './lista-de-espera-panel';

const SEDE = '/api/v1/consultorios/3';
const OFERTAS = `${SEDE}/ofertas`;
const PROFESIONALES = `${SEDE}/disponibilidad/profesionales`;
const CONTEXTO_DE_ANA = `${SEDE}/personas/12/contexto-de-agenda`;
const ESPERA = `${SEDE}/lista-de-espera`;
const ANA_URL = '/api/v1/personas/12';

const ANA = {
  id: 12,
  nombre: 'Ana',
  apellido: 'Perez',
  tipoDocumento: 'DNI',
  numeroDocumento: '30111222',
  esPaciente: true,
};
const OFERTA = { id: 14, nombreComercial: 'Kinesiologia', duracionMinutos: 45 };
const SIN_PROFESIONAL = { id: 15, nombreComercial: 'Grupal', requiereProfesional: false };
const LOPEZ = { id: 31, nombre: 'Lopez, Maria' };

const HOY = '2030-03-04';

/**
 * Anotar a alguien en la lista de espera: lo que el contexto ya sabe se muestra como dato, y lo que se
 * manda es lo que le sirve a la persona, sin mandar vacíos que el backend leería como una restricción.
 */
describe('ListaDeEsperaPanel', () => {
  let httpMock: HttpTestingController;
  let cerrado: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListaDeEsperaPanel],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    cerrado = 0;
    fijarReloj(`${HOY}T15:00:00Z`);
  });

  afterEach(() => {
    soltarReloj();
    httpMock.verify();
  });

  it('con contexto muestra los datos sin preguntarlos y anota con lo que le sirve', async () => {
    const fixture = await completo({
      origen: 'CASO',
      personaId: 12,
      casoId: 9,
      planId: 5,
      ofertaId: 14,
      profesionalId: 31,
      fecha: '2030-03-10',
    });
    httpMock.expectOne(CONTEXTO_DE_ANA).flush({
      casos: [
        {
          casoId: 9,
          numeroCaso: 2,
          ofertaNombre: 'Kinesiologia',
          planes: [{ planId: 5, numeroPlan: 1 }],
        },
      ],
    });
    await asentar(fixture);

    expect(raiz(fixture).querySelector('#espera-oferta')).toBeNull();
    expect(raiz(fixture).querySelector('#espera-profesional')).toBeNull();
    expect(raiz(fixture).querySelector('#espera-desde')).toBeNull();
    expect(raiz(fixture).querySelector('#flujo-paciente')).toBeNull();
    expect(texto(fixture)).toContain('Perez, Ana');
    expect(texto(fixture)).toContain('Caso 2 · Kinesiologia — Plan 1');
    expect(texto(fixture)).toContain('Lopez, Maria');

    marcarDia(fixture, 'Jue');
    marcarDia(fixture, 'Lun');
    fijar(fixture, '#espera-hora-desde', '14:00');
    fijar(fixture, '#espera-hora-hasta', '18:00');
    fijar(fixture, '#espera-prioridad', 'URGENTE');
    escribir(fixture, '#espera-notas', '  Prefiere por la tarde  ');
    await asentar(fixture);

    const flujo = TestBed.inject(FlujoDeTurnosStore);
    const cambios = flujo.cambios();
    clic(fixture, 'Agregar a la lista');
    const alta = httpMock.expectOne((r) => r.url === ESPERA && r.method === 'POST');
    expect(alta.request.body).toEqual({
      personaId: 12,
      ofertaId: 14,
      profesionalId: 31,
      casoId: 9,
      planId: 5,
      fechaDesde: '2030-03-10',
      fechaHasta: '2030-03-24',
      dias: [1, 4],
      horaDesde: '14:00:00',
      horaHasta: '18:00:00',
      prioridad: 'URGENTE',
      notas: 'Prefiere por la tarde',
    });
    alta.flush({ id: 1 });
    await asentar(fixture);

    expect(cerrado).toBe(1);
    expect(flujo.cambios()).toBe(cambios + 1);
    expect(TestBed.inject(AvisosStore).avisos()[0].titulo).toBe(
      'Paciente agregado a la lista de espera.',
    );
  });

  it('sin días ni franja no manda vacíos: quiere decir "cualquiera"', async () => {
    const fixture = await completo({ origen: 'PACIENTE', personaId: 12, ofertaId: 14 });

    clic(fixture, 'Agregar a la lista');
    const alta = httpMock.expectOne((r) => r.url === ESPERA && r.method === 'POST');
    expect(alta.request.body).toEqual({
      personaId: 12,
      ofertaId: 14,
      fechaDesde: HOY,
      fechaHasta: '2030-03-18',
      prioridad: 'NORMAL',
    });
    alta.flush({ id: 1 });
  });

  it('una fecha ya pasada del contexto no le sirve a nadie: arranca hoy y se puede cambiar', async () => {
    const fixture = await completo({ origen: 'AGENDA', personaId: 12, fecha: '2020-01-01' });

    expect(valor(fixture, '#espera-desde')).toBe(HOY);
    expect(valor(fixture, '#espera-hasta')).toBe('2030-03-18');
  });

  it('la fecha del contexto se puede cambiar sin volver a empezar', async () => {
    const fixture = await completo({ origen: 'AGENDA', personaId: 12, fecha: '2030-03-10' });
    expect(raiz(fixture).querySelector('#espera-desde')).toBeNull();

    clic(fixture, 'Cambiar');
    await asentar(fixture);

    expect(valor(fixture, '#espera-desde')).toBe('2030-03-10');
  });

  it('mover "desde" arrastra a "hasta" si seguía en el default o quedó antes', async () => {
    const fixture = await completo({ origen: 'AGENDA', personaId: 12 });

    fijar(fixture, '#espera-desde', '2030-04-01');
    await asentar(fixture);
    expect(valor(fixture, '#espera-hasta')).toBe('2030-04-15');

    // Elegida a mano y todavía después de "desde": se respeta.
    fijar(fixture, '#espera-hasta', '2030-05-20');
    await asentar(fixture);
    fijar(fixture, '#espera-desde', '2030-04-02');
    await asentar(fixture);
    expect(valor(fixture, '#espera-hasta')).toBe('2030-05-20');

    // Elegida a mano y ahora antes de "desde": no puede quedar invertida.
    fijar(fixture, '#espera-desde', '2030-06-01');
    await asentar(fixture);
    expect(valor(fixture, '#espera-hasta')).toBe('2030-06-15');
  });

  describe('dice qué falta en vez de quedar mudo', () => {
    it.each([
      ['#espera-hasta', '', 'Faltan las fechas.'],
      ['#espera-hasta', '2020-01-01', 'La fecha hasta no puede ser anterior a la fecha desde.'],
      ['#espera-hora-desde', '14:00', 'La franja lleva hora desde y hora hasta'],
    ])('%s = "%s"', async (selector, nuevo, mensaje) => {
      const fixture = await completo({ origen: 'PACIENTE', personaId: 12, ofertaId: 14 });

      fijar(fixture, selector, nuevo);
      await asentar(fixture);

      expect(raiz(fixture).querySelector('#espera-faltante')?.textContent).toContain(mensaje);
      expect(boton(fixture, 'Agregar a la lista')?.disabled).toBe(true);
    });

    it('la hora hasta tiene que ser posterior', async () => {
      const fixture = await completo({ origen: 'PACIENTE', personaId: 12, ofertaId: 14 });

      fijar(fixture, '#espera-hora-desde', '18:00');
      fijar(fixture, '#espera-hora-hasta', '14:00');
      await asentar(fixture);

      expect(raiz(fixture).querySelector('#espera-faltante')?.textContent).toContain(
        'posterior a la hora desde',
      );
    });

    it('sin paciente muestra el buscador; sin prestación, el selector', async () => {
      const fixture = await montar({ origen: 'LISTA_DE_ESPERA' });
      responderOfertas();
      responderProfesionales();
      await asentar(fixture);

      expect(raiz(fixture).querySelector('#flujo-paciente')).not.toBeNull();
      expect(raiz(fixture).querySelector('#espera-faltante')?.textContent).toContain(
        'Falta elegir el paciente.',
      );
    });

    it('sin prestación elegida lo dice', async () => {
      const fixture = await completo({ origen: 'PACIENTE', personaId: 12 });

      expect(raiz(fixture).querySelector('#espera-faltante')?.textContent).toContain(
        'Falta elegir la prestación.',
      );
    });
  });

  it('quien no es paciente se activa desde el panel, y un fallo se muestra', async () => {
    const fixture = await montar({ origen: 'PACIENTE', personaId: 12, ofertaId: 14 });
    responderOfertas();
    responderProfesionales();
    httpMock.expectOne(ANA_URL).flush({ ...ANA, esPaciente: false });
    await asentar(fixture);
    expect(texto(fixture)).toContain('Esta persona todavía no es paciente');

    clic(fixture, 'Activar como paciente');
    httpMock
      .expectOne(`${ANA_URL}/perfil-paciente`)
      .flush({ status: 500, detail: 'No se pudo' }, { status: 500, statusText: 'E' });
    await asentar(fixture);
    expect(texto(fixture)).toContain('No se pudo');

    clic(fixture, 'Activar como paciente');
    httpMock.expectOne(`${ANA_URL}/perfil-paciente`).flush(ANA);
    await asentar(fixture);
    expect(texto(fixture)).not.toContain('Esta persona todavía no es paciente');
  });

  it('si el backend rechaza por falta de perfil ofrece activarlo y no cierra', async () => {
    const fixture = await completo({ origen: 'PACIENTE', personaId: 12, ofertaId: 14 });

    clic(fixture, 'Agregar a la lista');
    httpMock
      .expectOne((r) => r.url === ESPERA && r.method === 'POST')
      .flush(
        { type: 'https://akine.app/problems/persona-sin-perfil-paciente', status: 409 },
        { status: 409, statusText: 'C' },
      );
    await asentar(fixture);

    expect(cerrado).toBe(0);
    expect(texto(fixture)).toContain('No pudimos agregarlo a la lista');
    expect(boton(fixture, 'Activar como paciente')).toBeDefined();
  });

  it('una respuesta lenta de otra prestación no pisa la lista de la elegida', async () => {
    const fixture = await montar({ origen: 'PACIENTE', personaId: 12 });
    responderOfertas();
    const primera = responderPedidoDeProfesionales();
    httpMock.expectOne(ANA_URL).flush(ANA);
    await asentar(fixture);

    fijar(fixture, '#espera-oferta', '14');
    const deLaElegida = responderPedidoDeProfesionales();
    deLaElegida.flush([LOPEZ]);
    primera.flush([{ id: 99, nombre: 'Otro, Viejo' }]);
    await asentar(fixture);

    expect(texto(fixture)).toContain('Lopez, Maria');
    expect(texto(fixture)).not.toContain('Otro, Viejo');
  });

  it('el preferido de antes que no presta la prestación nueva se suelta; el del contexto no', async () => {
    const fixture = await completo({ origen: 'PACIENTE', personaId: 12 });

    fijar(fixture, '#espera-profesional', '31');
    await asentar(fixture);
    fijar(fixture, '#espera-oferta', '14');
    responderPedidoDeProfesionales().flush([{ id: 40, nombre: 'Diaz, Juan' }]);
    await asentar(fixture);

    expect(valor(fixture, '#espera-profesional')).toBe('');
  });

  it('una prestación sin profesional no lo pregunta ni lo manda', async () => {
    const fixture = await completo({ origen: 'PACIENTE', personaId: 12 });

    fijar(fixture, '#espera-oferta', '15');
    responderPedidoDeProfesionales().flush([]);
    await asentar(fixture);
    expect(raiz(fixture).querySelector('#espera-profesional')).toBeNull();

    clic(fixture, 'Agregar a la lista');
    const alta = httpMock.expectOne((r) => r.url === ESPERA && r.method === 'POST');
    expect(alta.request.body.profesionalId).toBeUndefined();
    alta.flush({ id: 1 });
  });

  it('si no se pudo leer el contexto igual dice que el caso o el plan van', async () => {
    const fixture = await completo({ origen: 'CASO', personaId: 12, casoId: 9, ofertaId: 14 });
    httpMock.expectOne(CONTEXTO_DE_ANA).flush('', { status: 500, statusText: 'E' });
    await asentar(fixture);

    expect(texto(fixture)).toContain('El caso elegido');
  });

  it('elegir un paciente del buscador se puede cambiar', async () => {
    // `debounceTime` mide con `Date`: con el reloj fijo la espera de la búsqueda nunca termina.
    soltarReloj();
    const fixture = await montar({ origen: 'LISTA_DE_ESPERA', ofertaId: 14 });
    responderOfertas();
    responderProfesionales();
    await asentar(fixture);

    const campo = raiz(fixture).querySelector('#flujo-paciente') as HTMLInputElement;
    campo.value = 'Perez';
    campo.dispatchEvent(new Event('input'));
    await new Promise((listo) => setTimeout(listo, 350));
    httpMock.expectOne((r) => r.url === '/api/v1/personas').flush({ content: [ANA] });
    await asentar(fixture);
    // El buscador ofrece el alta detrás de un permiso, que pide al dibujar los resultados.
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [] });
    await asentar(fixture);
    (raiz(fixture).querySelector('.candidato') as HTMLButtonElement).click();
    await asentar(fixture);
    expect(texto(fixture)).toContain('DNI 30111222');

    clic(fixture, 'Cambiar');
    await asentar(fixture);
    expect(raiz(fixture).querySelector('#flujo-paciente')).not.toBeNull();
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await completo({ origen: 'PACIENTE', personaId: 12 });
      await esperarSinViolaciones(raiz(fixture));
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------

  async function montar(contexto: ContextoDeTurno): Promise<ComponentFixture<ListaDeEsperaPanel>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    const fixture = TestBed.createComponent(ListaDeEsperaPanel);
    fixture.componentRef.setInput('contexto', contexto);
    fixture.componentInstance.cerrar.subscribe(() => cerrado++);
    fixture.detectChanges();
    return fixture;
  }

  /** Con el paciente leído y los catálogos respondidos. */
  async function completo(
    contexto: ContextoDeTurno,
  ): Promise<ComponentFixture<ListaDeEsperaPanel>> {
    const fixture = await montar(contexto);
    responderOfertas();
    responderProfesionales();
    httpMock.expectOne(ANA_URL).flush(ANA);
    await asentar(fixture);
    return fixture;
  }

  function responderOfertas(): void {
    httpMock.expectOne((r) => r.url === OFERTAS).flush([OFERTA, SIN_PROFESIONAL]);
  }

  function responderProfesionales(): void {
    responderPedidoDeProfesionales().flush([LOPEZ]);
  }

  function responderPedidoDeProfesionales(): TestRequest {
    return httpMock.expectOne((r) => r.url === PROFESIONALES);
  }

  function raiz(fixture: ComponentFixture<ListaDeEsperaPanel>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function texto(fixture: ComponentFixture<ListaDeEsperaPanel>): string {
    return (raiz(fixture).textContent ?? '').replace(/\s+/g, ' ');
  }

  function valor(fixture: ComponentFixture<ListaDeEsperaPanel>, selector: string): string {
    return (raiz(fixture).querySelector(selector) as HTMLInputElement | HTMLSelectElement).value;
  }

  function fijar(
    fixture: ComponentFixture<ListaDeEsperaPanel>,
    selector: string,
    nuevo: string,
  ): void {
    const campo = raiz(fixture).querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    campo.value = nuevo;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<ListaDeEsperaPanel>,
    selector: string,
    nuevo: string,
  ): void {
    const campo = raiz(fixture).querySelector(selector) as HTMLTextAreaElement;
    campo.value = nuevo;
    campo.dispatchEvent(new Event('input'));
  }

  function marcarDia(fixture: ComponentFixture<ListaDeEsperaPanel>, dia: string): void {
    const etiqueta = Array.from(raiz(fixture).querySelectorAll('.dias-semana label')).find(
      (label) => (label.textContent ?? '').trim() === dia,
    );
    (etiqueta?.querySelector('input') as HTMLInputElement).dispatchEvent(new Event('change'));
  }

  function boton(
    fixture: ComponentFixture<ListaDeEsperaPanel>,
    rotulo: string,
  ): HTMLButtonElement | undefined {
    return Array.from(raiz(fixture).querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === rotulo,
    );
  }

  function clic(fixture: ComponentFixture<ListaDeEsperaPanel>, rotulo: string): void {
    const encontrado = boton(fixture, rotulo);
    if (encontrado === undefined) {
      throw new Error(`No está el botón "${rotulo}"`);
    }
    encontrado.click();
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<ListaDeEsperaPanel>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
