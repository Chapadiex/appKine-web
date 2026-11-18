import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TratamientosDeSesion, parametroParaEnviar } from './tratamientos-de-sesion';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { ParametroDeTratamientoTipoDatoEnum } from '../../../../api/generated/model/parametro-de-tratamiento';

const ORG = 1;
const CONSULTORIO = 3;
const SESION = 501;
const OFERTA = 4;
const BASE = `/api/v1/consultorios/${CONSULTORIO}/sesiones/${SESION}/tratamientos`;
const VER = `/api/v1/consultorios/${CONSULTORIO}/sesiones/${SESION}`;
const PRACTICAS = `/api/v1/consultorios/${CONSULTORIO}/ofertas/${OFERTA}/practicas`;
const ESPACIOS = `/api/v1/organizations/${ORG}/consultorios/${CONSULTORIO}/espacios`;

const ELECTRO = {
  id: 1,
  practicaId: 70,
  nombre: 'Electroterapia',
  codigo: 'ELEC',
  estado: 'ACTIVO',
  principal: true,
  vigenteEnCatalogo: true,
};
const MANUAL = {
  id: 2,
  practicaId: 71,
  nombre: 'Terapia manual',
  estado: 'ACTIVO',
  vigenteEnCatalogo: true,
};
const DADA_DE_BAJA = {
  id: 3,
  practicaId: 72,
  nombre: 'Laser',
  estado: 'ACTIVO',
  vigenteEnCatalogo: false,
};

const REGISTRADO = {
  id: 900,
  orden: 1,
  practicaId: 70,
  practicaNombre: 'Electroterapia',
  practicaCodigo: 'ELEC',
  zona: 'rodilla',
  lateralidad: 'DERECHA',
  duracionMinutos: 15,
  parametros: [{ clave: 'Intensidad', tipoDato: 'NUMERICO', valorNumerico: 20, unidad: 'mA' }],
  sesionVersion: 8,
};

/**
 * Spec de los tratamientos realizados (AKINE-06.04).
 *
 * <p>Lo que decide comportamiento: la escritura manda la version que la pantalla le pasa y le
 * devuelve la nueva, cada parametro viaja con su tipo, la baja exige motivo y adopta la version que devuelve, y
 * los conflictos de la atencion se le pasan a la pantalla en vez de resolverse aca.
 */
describe('TratamientosDeSesion', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TratamientosDeSesion],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('ofrece solo las prácticas vigentes de la oferta y preselecciona la principal', async () => {
    const fixture = await montar();

    const opciones = Array.from(
      fixture.nativeElement.querySelectorAll(
        '#tratamiento-practica option',
      ) as NodeListOf<HTMLOptionElement>,
    ).map((o) => o.textContent?.trim());
    expect(opciones).toContain('Electroterapia');
    expect(opciones).toContain('Terapia manual');
    expect(opciones).not.toContain('Laser');
    expect(
      (fixture.nativeElement.querySelector('#tratamiento-practica') as HTMLSelectElement).value,
    ).toBe('70');
  });

  it('registra con la versión recibida, parametros tipados, y devuelve la versión nueva', async () => {
    const fixture = await montar();
    const versiones: number[] = [];
    const enVuelo: boolean[] = [];
    fixture.componentInstance.versionCambio.subscribe((v) => versiones.push(v));
    fixture.componentInstance.enVuelo.subscribe((v) => enVuelo.push(v));

    // La zona escrita en "Otra…" del combo; el lado, un chip.
    escribir(fixture, '#tratamiento-zona', 'rodilla');
    tocar(fixture, '#tratamiento-lateralidad', 'Der');
    escribir(fixture, '#tratamiento-duracion', '15');
    elegir(fixture, '#tratamiento-espacio', '30');
    apretar(fixture, 'Agregar un parámetro');
    elegir(fixture, '#parametro-clave-0', 'Intensidad');
    escribir(fixture, '#parametro-valor-0', '20');
    escribir(fixture, '#parametro-unidad-0', 'mA');
    apretar(fixture, 'Registrar el tratamiento');

    const pedido = httpMock.expectOne((p) => p.method === 'POST' && p.url === BASE);
    expect(pedido.request.body).toEqual({
      version: 7,
      practicaId: 70,
      zona: 'rodilla',
      lateralidad: 'DERECHA',
      duracionMinutos: 15,
      espacioId: 30,
      parametros: [{ clave: 'Intensidad', tipoDato: 'NUMERICO', valorNumerico: 20, unidad: 'mA' }],
    });
    pedido.flush(REGISTRADO);
    await estabilizar(fixture);

    expect(versiones).toEqual([8]);
    expect(enVuelo).toEqual([true, false]);
    expect(texto(fixture)).toContain('1. Electroterapia');
    expect(texto(fixture)).toContain('20 mA');
    // UX-12: el resultado es un aviso global.
    expect(TestBed.inject(AvisosStore).avisos()[0]?.titulo).toBe('Tratamiento registrado');
  });

  it('un parametro sin nombre o un número que no es número no sale', async () => {
    const fixture = await montar();

    apretar(fixture, 'Agregar un parámetro');
    apretar(fixture, 'Registrar el tratamiento');
    expect(texto(fixture)).toContain('sin nombre');

    elegir(fixture, '#parametro-clave-0', 'Series');
    escribir(fixture, '#parametro-valor-0', 'tres');
    apretar(fixture, 'Registrar el tratamiento');
    expect(texto(fixture)).toContain('no es un número');
    httpMock.expectNone((p) => p.method === 'POST');
  });

  it('la duración va en minutos enteros', async () => {
    const fixture = await montar();
    escribir(fixture, '#tratamiento-duracion', '7,5');
    apretar(fixture, 'Registrar el tratamiento');
    expect(texto(fixture)).toContain('minutos enteros');
    httpMock.expectNone((p) => p.method === 'POST');
  });

  it('cambiar el tipo de un parametro limpia el valor, y quitarlo lo saca de la lista', async () => {
    const fixture = await montar();
    apretar(fixture, 'Agregar un parámetro');
    escribir(fixture, '#parametro-valor-0', '20');
    marcar(fixture, '#parametro-tipo-0', 'BOOLEANO');
    expect(fixture.nativeElement.querySelector('#parametro-unidad-0')).toBeNull();
    marcar(fixture, '#parametro-valor-0', 'si');
    // Un nombre fuera de las sugerencias se escribe con "Otro…".
    elegir(fixture, '#parametro-clave-0', '__otro__');
    escribir(fixture, '#parametro-clave-0', 'Supervisado');
    apretar(fixture, 'Registrar el tratamiento');
    const pedido = httpMock.expectOne((p) => p.method === 'POST');
    expect((pedido.request.body as { parametros: unknown[] }).parametros).toEqual([
      { clave: 'Supervisado', tipoDato: 'BOOLEANO', valorBooleano: true },
    ]);
    pedido.flush({ ...REGISTRADO, parametros: [] });
    await estabilizar(fixture);

    apretar(fixture, 'Agregar un parámetro');
    apretar(fixture, 'Quitar el parámetro 1');
    expect(fixture.nativeElement.querySelector('#parametro-clave-0')).toBeNull();
  });

  it('la baja exige motivo y adopta la versión que devuelve, sin releer la sesión', async () => {
    const fixture = await montar(true, [REGISTRADO]);
    const versiones: number[] = [];
    const enVuelo: boolean[] = [];
    fixture.componentInstance.versionCambio.subscribe((v) => versiones.push(v));
    fixture.componentInstance.enVuelo.subscribe((v) => enVuelo.push(v));

    apretar(fixture, 'Dar de baja');
    apretar(fixture, 'Confirmar la baja');
    expect(texto(fixture)).toContain('Falta el motivo');
    httpMock.expectNone((p) => p.method === 'DELETE');

    escribir(fixture, '#baja-motivo-900', 'El paciente refirio molestia');
    apretar(fixture, 'Confirmar la baja');
    const baja = httpMock.expectOne((p) => p.method === 'DELETE' && p.url === `${BASE}/900`);
    expect(baja.request.body).toEqual({ motivo: 'El paciente refirio molestia', version: 7 });
    baja.flush({ ...REGISTRADO, vigente: false, sesionVersion: 9 });
    await estabilizar(fixture);

    httpMock.expectNone((p) => p.method === 'GET' && p.url === VER);
    expect(versiones).toEqual([9]);
    expect(enVuelo).toEqual([true, false]);
    expect(texto(fixture)).not.toContain('1. Electroterapia');
    expect(TestBed.inject(AvisosStore).avisos()[0]?.titulo).toBe('Tratamiento dado de baja');
  });

  it('cancelar la baja no manda nada', async () => {
    const fixture = await montar(true, [REGISTRADO]);
    apretar(fixture, 'Dar de baja');
    apretar(fixture, 'No dar de baja');
    expect(fixture.nativeElement.querySelector('#baja-motivo-900')).toBeNull();
  });

  it('un 409 de versión se le pasa a la pantalla, que es la que sabe releer', async () => {
    const fixture = await montar();
    const problemas: unknown[] = [];
    fixture.componentInstance.problema.subscribe((p) => problemas.push(p));

    apretar(fixture, 'Registrar el tratamiento');
    httpMock
      .expectOne((p) => p.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/concurrent-modification',
          status: 409,
          detail: 'Vieja.',
        },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(problemas).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('una práctica dada de baja se explica acá, sin molestar a la pantalla', async () => {
    const fixture = await montar();
    const problemas: unknown[] = [];
    fixture.componentInstance.problema.subscribe((p) => problemas.push(p));

    apretar(fixture, 'Registrar el tratamiento');
    httpMock
      .expectOne((p) => p.method === 'POST')
      .flush(
        { type: 'https://akine.app/problems/practica-no-utilizable', status: 409, detail: 'Baja.' },
        { status: 409, statusText: 'Conflict' },
      );
    await estabilizar(fixture);

    expect(problemas).toHaveLength(0);
    expect(texto(fixture)).toContain('no se puede asentar');
  });

  it('una oferta sin prácticas lo dice en vez de ofrecer un formulario vacío', async () => {
    const fixture = await montar(true, [], []);
    expect(texto(fixture)).toContain('no declara prácticas');
    expect(fixture.nativeElement.querySelector('#tratamiento-practica')).toBeNull();
  });

  it('cerrada se lee sin formulario, sin prácticas ni espacios', async () => {
    const fixture = await montar(false, [REGISTRADO]);
    expect(texto(fixture)).toContain('Electroterapia');
    // La columna "Minutos" de la tabla compacta.
    const fila = fixture.nativeElement.querySelector('tbody tr') as HTMLElement;
    expect(fila.querySelectorAll('td')[3]?.textContent?.trim()).toBe('15');
    expect(fixture.nativeElement.querySelector('#tratamiento-practica')).toBeNull();
  });

  it('sin tratamientos lo dice con el estado vacio y el formulario va en la grilla de 12 (UX-14)', async () => {
    const fixture = await montar();
    const raiz = fixture.nativeElement as HTMLElement;
    expect(raiz.querySelector('app-estado-vacio')?.textContent).toContain(
      'Todavía no hay tratamientos registrados',
    );
    // La carga va en una sola fila (13/11/2026), como la de mediciones.
    const fila = raiz.querySelector('#tratamiento-practica')?.closest('.carga-medicion');
    expect(fila).not.toBeNull();
    expect(fila?.querySelector('#tratamiento-duracion')).not.toBeNull();
  });

  it('avisa la lateralidad sin zona antes de que el servidor la rechace', async () => {
    const fixture = await montar();
    tocar(fixture, '#tratamiento-lateralidad', 'Izq');
    expect(texto(fixture)).toContain('sin decir de qué zona');
  });

  it('parametroParaEnviar rechaza un texto vacío y un si/no sin elegir', () => {
    const base = { clave: 'Tecnica', valor: '', valorSiNo: null, unidad: '' };
    expect(
      typeof parametroParaEnviar({ ...base, tipoDato: ParametroDeTratamientoTipoDatoEnum.TEXTO }),
    ).toBe('string');
    expect(
      typeof parametroParaEnviar({
        ...base,
        tipoDato: ParametroDeTratamientoTipoDatoEnum.BOOLEANO,
      }),
    ).toBe('string');
    expect(
      parametroParaEnviar({
        ...base,
        valor: ' Kaltenborn ',
        tipoDato: ParametroDeTratamientoTipoDatoEnum.TEXTO,
      }),
    ).toEqual({ clave: 'Tecnica', tipoDato: 'TEXTO', valorTexto: 'Kaltenborn' });
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar(true, [REGISTRADO]);
      apretar(fixture, 'Agregar un parámetro');
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------

  async function montar(
    editable = true,
    tratamientos: object[] = [],
    practicas: object[] = [ELECTRO, MANUAL, DADA_DE_BAJA],
  ): Promise<ComponentFixture<TratamientosDeSesion>> {
    const fixture = TestBed.createComponent(TratamientosDeSesion);
    fixture.componentRef.setInput('consultorioId', CONSULTORIO);
    fixture.componentRef.setInput('organizationId', ORG);
    fixture.componentRef.setInput('sesionId', SESION);
    fixture.componentRef.setInput('ofertaId', OFERTA);
    fixture.componentRef.setInput('version', 7);
    fixture.componentRef.setInput('editable', editable);
    fixture.detectChanges();

    httpMock.expectOne((p) => p.method === 'GET' && p.url === BASE).flush(tratamientos);
    if (editable) {
      httpMock.expectOne((p) => p.url === PRACTICAS).flush({ ofertaId: OFERTA, practicas });
      httpMock.expectOne((p) => p.url === ESPACIOS).flush({ content: [{ id: 30, name: 'Box 1' }] });
    }
    await estabilizar(fixture);
    return fixture;
  }

  async function estabilizar(fixture: ComponentFixture<TratamientosDeSesion>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function elegir(
    fixture: ComponentFixture<TratamientosDeSesion>,
    selector: string,
    valor: string,
  ) {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<TratamientosDeSesion>,
    selector: string,
    valor: string,
  ) {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    // "Otra…" zona se toma en el change, como al salir del campo.
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** Toca el chip rotulado `rotulo` dentro del grupo `selector`. */
  function tocar(
    fixture: ComponentFixture<TratamientosDeSesion>,
    selector: string,
    rotulo: string,
  ) {
    const grupo = fixture.nativeElement.querySelector(selector) as HTMLElement;
    const chip = Array.from(grupo.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === rotulo,
    );
    if (chip === undefined) {
      throw new Error(`No hay ningún chip rotulado "${rotulo}" en ${selector}.`);
    }
    chip.click();
    fixture.detectChanges();
  }

  /** Marca la opción `valor` de un `app-segmentado`. */
  function marcar(
    fixture: ComponentFixture<TratamientosDeSesion>,
    selector: string,
    valor: string,
  ) {
    const radio = fixture.nativeElement.querySelector(
      `${selector} input[type="radio"][value="${valor}"]`,
    ) as HTMLInputElement;
    radio.click();
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<TratamientosDeSesion>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim().startsWith(rotulo));
    if (boton === undefined) {
      throw new Error(`No hay ningún botón rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<TratamientosDeSesion>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
