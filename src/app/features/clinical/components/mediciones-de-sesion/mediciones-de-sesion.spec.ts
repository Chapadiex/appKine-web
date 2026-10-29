import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MedicionesDeSesion } from './mediciones-de-sesion';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { AvisosStore } from '../../../../core/services/avisos.store';

const CONSULTORIO = 3;
const SESION = 501;
const BASE = `/api/v1/consultorios/${CONSULTORIO}/sesiones/${SESION}/mediciones`;
const DEFINICIONES = '/api/v1/mediciones/definiciones';

const ROM = {
  id: 11,
  codigo: 'ROM_RODILLA',
  name: 'Flexion de rodilla',
  tipo: 'NUMERICO',
  unidad: 'grados',
  minimo: 0,
  maximo: 180,
};
const EDEMA = { id: 12, codigo: 'EDEMA', name: 'Edema', tipo: 'BOOLEANO' };
const MARCHA = { id: 13, codigo: 'MARCHA', name: 'Marcha', tipo: 'TEXTO' };

const COMPARACION = {
  sesionAnteriorId: 400,
  acotadaAlCaso: true,
  medidas: [
    {
      definicionId: 11,
      nombre: 'Flexion de rodilla',
      lateralidad: 'DERECHA',
      anterior: { valorNumerico: 90, unidad: 'grados', tipo: 'NUMERICO' },
      actual: { valorNumerico: 100, unidad: 'grados', tipo: 'NUMERICO' },
      delta: 10,
    },
    {
      definicionId: 11,
      nombre: 'Flexion de rodilla',
      lateralidad: 'IZQUIERDA',
      anterior: { valorNumerico: 95, unidad: 'grados', tipo: 'NUMERICO' },
    },
    {
      definicionId: 14,
      nombre: 'Fuerza',
      lateralidad: 'NO_APLICA',
      anterior: { valorNumerico: 4, unidad: 'kg' },
      actual: { valorNumerico: 4, unidad: 'lb' },
      unidadesDifieren: true,
    },
  ],
};

/**
 * Spec del examen fisico de la atencion (AKINE-06.03).
 *
 * <p>Lo que decide comportamiento: se manda <b>exactamente un</b> valor —el del tipo—, el lado
 * viaja como parte de la clave, el rango que manda el servidor se muestra, "volver a tomar"
 * precarga sin guardar, y una sesion cerrada se lee sin ofrecer escritura.
 */
describe('MedicionesDeSesion', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MedicionesDeSesion],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('muestra hoy al lado de la vez pasada, el cambio, y no resta unidades distintas', async () => {
    const fixture = await montar();

    const visible = texto(fixture);
    expect(visible).toContain('mismo caso clínico');
    expect(visible).toContain('Subio 10');
    expect(visible).toContain('Unidades distintas: no se resta');
    expect(visible).toContain('2 de 18');
  });

  it('una numerica manda solo valorNumerico, con el lado en la consulta', async () => {
    const fixture = await montar();

    elegir(fixture, '#medicion-definicion', '11');
    elegir(fixture, '#medicion-lado', 'IZQUIERDA');
    escribir(fixture, '#medicion-valor', '97,5');
    apretar(fixture, 'Registrar la medición');

    const pedido = httpMock.expectOne((p) => p.method === 'PUT' && p.url === `${BASE}/11`);
    expect(pedido.request.params.get('lateralidad')).toBe('IZQUIERDA');
    expect(pedido.request.body).toEqual({ valorNumerico: 97.5 });
    pedido.flush({ id: 1 });
    await recargar(fixture);

    // UX-12: el resultado es un aviso global.
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Medición registrada');
    expect(aviso?.descripcion).toBe('Flexion de rodilla');
  });

  it('una de si o no manda valorBooleano y una de texto manda valorTexto', async () => {
    const fixture = await montar();

    elegir(fixture, '#medicion-definicion', '12');
    const no = fixture.nativeElement.querySelectorAll(
      'input[name="medicion-si-no"]',
    )[1] as HTMLInputElement;
    no.click();
    fixture.detectChanges();
    apretar(fixture, 'Registrar la medición');
    const booleana = httpMock.expectOne((p) => p.method === 'PUT' && p.url === `${BASE}/12`);
    expect(booleana.request.body).toEqual({ valorBooleano: false });
    booleana.flush({ id: 2 });
    await recargar(fixture);

    elegir(fixture, '#medicion-definicion', '13');
    escribir(fixture, '#medicion-valor', 'claudicante');
    escribir(fixture, '#medicion-nota', 'en pasillo');
    apretar(fixture, 'Registrar la medición');
    const textual = httpMock.expectOne((p) => p.method === 'PUT' && p.url === `${BASE}/13`);
    expect(textual.request.params.get('lateralidad')).toBe('NO_APLICA');
    expect(textual.request.body).toEqual({ valorTexto: 'claudicante', nota: 'en pasillo' });
    textual.flush({ id: 3 });
    await recargar(fixture);
  });

  it('sin valor no manda nada y dice que falta', async () => {
    const fixture = await montar();

    apretar(fixture, 'Registrar la medición');
    expect(texto(fixture)).toContain('Elegí que medida');

    elegir(fixture, '#medicion-definicion', '11');
    escribir(fixture, '#medicion-valor', 'mucho');
    apretar(fixture, 'Registrar la medición');
    expect(texto(fixture)).toContain('no es un número');
    httpMock.expectNone((p) => p.method === 'PUT');
  });

  it('fuera de rango muestra el rango que devolvio el servidor', async () => {
    const fixture = await montar();

    elegir(fixture, '#medicion-definicion', '11');
    expect(texto(fixture)).toContain('Admite de 0 a 180 grados');
    escribir(fixture, '#medicion-valor', '200');
    apretar(fixture, 'Registrar la medición');
    httpMock
      .expectOne((p) => p.method === 'PUT')
      .flush(
        {
          type: 'https://akine.app/problems/medicion-fuera-de-rango',
          status: 400,
          detail: 'Fuera de rango.',
          minimo: 0,
          maximo: 180,
        },
        { status: 400, statusText: 'Bad Request' },
      );
    await estabilizar(fixture);

    // El rechazo va arriba del formulario de la medicion (UX-12).
    const alerta = (fixture.nativeElement as HTMLElement).querySelector('fieldset app-alerta');
    expect(alerta?.textContent).toContain('No pudimos registrar la medición');
    expect(alerta?.textContent).toContain('El catalogo admite de 0 a 180');
  });

  it('volver a tomar precarga el valor anterior y el lado, sin guardar nada', async () => {
    const fixture = await montar();

    apretar(fixture, 'Volver a tomar');
    expect((fixture.nativeElement.querySelector('#medicion-valor') as HTMLInputElement).value).toBe(
      '95',
    );
    expect((fixture.nativeElement.querySelector('#medicion-lado') as HTMLSelectElement).value).toBe(
      'IZQUIERDA',
    );
    httpMock.expectNone((p) => p.method === 'PUT');
  });

  it('quitar borra solo ese lado', async () => {
    const fixture = await montar();

    apretar(fixture, 'Quitar');
    const borrado = httpMock.expectOne((p) => p.method === 'DELETE' && p.url === `${BASE}/11`);
    expect(borrado.request.params.get('lateralidad')).toBe('DERECHA');
    borrado.flush(null, { status: 204, statusText: 'No Content' });
    await recargar(fixture);
    expect(TestBed.inject(AvisosStore).avisos()[0]?.titulo).toBe('Medición quitada');
  });

  it('un 409 de propiedad o de cierre no se muestra acá: se lo pasa a la atención', async () => {
    const fixture = await montar();
    const problemas: unknown[] = [];
    fixture.componentInstance.problema.subscribe((p) => problemas.push(p));

    apretar(fixture, 'Quitar');
    httpMock
      .expectOne((p) => p.method === 'DELETE')
      .flush(
        { type: 'https://akine.app/problems/sesion-cerrada', status: 409, detail: 'Cerrada.' },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(problemas).toHaveLength(1);
  });

  it('cerrada se lee sin formulario y sin pedir el catalogo', async () => {
    const fixture = await montar(false);

    expect(fixture.nativeElement.querySelector('#medicion-definicion')).toBeNull();
    expect(rotulos(fixture)).not.toContain('Quitar');
    httpMock.expectNone((p) => p.url === DEFINICIONES);
  });

  it('sin catalogo:read sigue mostrando lo medido y dice por que no puede medir (DP-36)', async () => {
    const fixture = TestBed.createComponent(MedicionesDeSesion);
    fixture.componentRef.setInput('consultorioId', CONSULTORIO);
    fixture.componentRef.setInput('sesionId', SESION);
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    responderLecturas();
    httpMock
      .expectOne((p) => p.url === DEFINICIONES)
      .flush(
        { type: 'https://akine.app/problems/forbidden', status: 403 },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('No tenés permiso para consultar el catálogo de medidas');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('#medicion-definicion')).toBeNull();
  });

  it('sin sesión anterior lo dice, en vez de dejar la columna vacía sin explicacion', async () => {
    const fixture = await montar(true, { medidas: [] });
    expect(texto(fixture)).toContain('estas son las primeras mediciones');
    expect(texto(fixture)).toContain('Todavía no hay mediciones');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar();
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------

  async function montar(
    editable = true,
    comparacion: object = COMPARACION,
  ): Promise<ComponentFixture<MedicionesDeSesion>> {
    const fixture = TestBed.createComponent(MedicionesDeSesion);
    fixture.componentRef.setInput('consultorioId', CONSULTORIO);
    fixture.componentRef.setInput('sesionId', SESION);
    fixture.componentRef.setInput('editable', editable);
    fixture.detectChanges();
    responderLecturas(comparacion);
    if (editable) {
      httpMock.expectOne((p) => p.url === DEFINICIONES).flush({ content: [ROM, EDEMA, MARCHA] });
    }
    await estabilizar(fixture);
    return fixture;
  }

  function responderLecturas(comparacion: object = COMPARACION): void {
    httpMock.expectOne(`${BASE}/comparacion`).flush(comparacion);
    httpMock
      .expectOne(BASE)
      .flush({ mediciones: [], definicionesCubiertas: 2, definicionesDisponibles: 18 });
  }

  async function recargar(fixture: ComponentFixture<MedicionesDeSesion>): Promise<void> {
    responderLecturas();
    await estabilizar(fixture);
  }

  async function estabilizar(fixture: ComponentFixture<MedicionesDeSesion>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function elegir(fixture: ComponentFixture<MedicionesDeSesion>, selector: string, valor: string) {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<MedicionesDeSesion>,
    selector: string,
    valor: string,
  ) {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<MedicionesDeSesion>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim().startsWith(rotulo));
    if (boton === undefined) {
      throw new Error(`No hay ningún botón rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function rotulos(fixture: ComponentFixture<MedicionesDeSesion>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((b) => (b.textContent ?? '').trim());
  }

  function texto(fixture: ComponentFixture<MedicionesDeSesion>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
