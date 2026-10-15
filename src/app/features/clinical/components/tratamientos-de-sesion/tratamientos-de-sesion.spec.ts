import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TratamientosDeSesion, parametroParaEnviar } from './tratamientos-de-sesion';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';
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
 * devuelve la nueva, cada parametro viaja con su tipo, la baja exige motivo y relee la version, y
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

  it('ofrece solo las practicas vigentes de la oferta y preselecciona la principal', async () => {
    const fixture = await montar();

    const opciones = Array.from(
      fixture.nativeElement.querySelectorAll(
        '#tratamiento-practica option',
      ) as NodeListOf<HTMLOptionElement>,
    ).map((o) => o.textContent?.trim());
    expect(opciones).toContain('Electroterapia (ELEC)');
    expect(opciones).toContain('Terapia manual');
    expect(opciones).not.toContain('Laser');
    expect(
      (fixture.nativeElement.querySelector('#tratamiento-practica') as HTMLSelectElement).value,
    ).toBe('70');
  });

  it('registra con la version recibida, parametros tipados, y devuelve la version nueva', async () => {
    const fixture = await montar();
    const versiones: number[] = [];
    const enVuelo: boolean[] = [];
    fixture.componentInstance.versionCambio.subscribe((v) => versiones.push(v));
    fixture.componentInstance.enVuelo.subscribe((v) => enVuelo.push(v));

    escribir(fixture, '#tratamiento-zona', 'rodilla');
    elegir(fixture, '#tratamiento-lateralidad', 'DERECHA');
    escribir(fixture, '#tratamiento-duracion', '15');
    elegir(fixture, '#tratamiento-espacio', '30');
    apretar(fixture, 'Agregar un parametro');
    escribir(fixture, '#parametro-clave-0', 'Intensidad');
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
    expect(texto(fixture)).toContain('Tratamiento registrado');
  });

  it('un parametro sin nombre o un numero que no es numero no sale', async () => {
    const fixture = await montar();

    apretar(fixture, 'Agregar un parametro');
    apretar(fixture, 'Registrar el tratamiento');
    expect(texto(fixture)).toContain('sin nombre');

    escribir(fixture, '#parametro-clave-0', 'Series');
    escribir(fixture, '#parametro-valor-0', 'tres');
    apretar(fixture, 'Registrar el tratamiento');
    expect(texto(fixture)).toContain('no es un numero');
    httpMock.expectNone((p) => p.method === 'POST');
  });

  it('la duracion va en minutos enteros', async () => {
    const fixture = await montar();
    escribir(fixture, '#tratamiento-duracion', '7,5');
    apretar(fixture, 'Registrar el tratamiento');
    expect(texto(fixture)).toContain('minutos enteros');
    httpMock.expectNone((p) => p.method === 'POST');
  });

  it('cambiar el tipo de un parametro limpia el valor, y quitarlo lo saca de la lista', async () => {
    const fixture = await montar();
    apretar(fixture, 'Agregar un parametro');
    escribir(fixture, '#parametro-valor-0', '20');
    elegir(fixture, '#parametro-tipo-0', 'BOOLEANO');
    expect(fixture.nativeElement.querySelector('#parametro-unidad-0')).toBeNull();
    elegir(fixture, '#parametro-valor-0', 'si');
    escribir(fixture, '#parametro-clave-0', 'Supervisado');
    apretar(fixture, 'Registrar el tratamiento');
    const pedido = httpMock.expectOne((p) => p.method === 'POST');
    expect((pedido.request.body as { parametros: unknown[] }).parametros).toEqual([
      { clave: 'Supervisado', tipoDato: 'BOOLEANO', valorBooleano: true },
    ]);
    pedido.flush({ ...REGISTRADO, parametros: [] });
    await estabilizar(fixture);

    apretar(fixture, 'Agregar un parametro');
    apretar(fixture, 'Quitar el parametro 1');
    expect(fixture.nativeElement.querySelector('#parametro-clave-0')).toBeNull();
  });

  it('la baja exige motivo, y despues relee la sesion para tomar la version nueva', async () => {
    const fixture = await montar(true, [REGISTRADO]);
    const versiones: number[] = [];
    fixture.componentInstance.versionCambio.subscribe((v) => versiones.push(v));

    apretar(fixture, 'Dar de baja');
    apretar(fixture, 'Confirmar la baja');
    expect(texto(fixture)).toContain('Falta el motivo');
    httpMock.expectNone((p) => p.method === 'DELETE');

    escribir(fixture, '#baja-motivo-900', 'El paciente refirio molestia');
    apretar(fixture, 'Confirmar la baja');
    const baja = httpMock.expectOne((p) => p.method === 'DELETE' && p.url === `${BASE}/900`);
    expect(baja.request.body).toEqual({ motivo: 'El paciente refirio molestia', version: 7 });
    baja.flush(null, { status: 204, statusText: 'No Content' });
    httpMock
      .expectOne((p) => p.method === 'GET' && p.url === VER)
      .flush({ id: SESION, version: 9 });
    await estabilizar(fixture);

    expect(versiones).toEqual([9]);
    expect(texto(fixture)).not.toContain('1. Electroterapia');
    expect(texto(fixture)).toContain('dado de baja');
  });

  it('cancelar la baja no manda nada', async () => {
    const fixture = await montar(true, [REGISTRADO]);
    apretar(fixture, 'Dar de baja');
    apretar(fixture, 'No dar de baja');
    expect(fixture.nativeElement.querySelector('#baja-motivo-900')).toBeNull();
  });

  it('un 409 de version se le pasa a la pantalla, que es la que sabe releer', async () => {
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

  it('una practica dada de baja se explica aca, sin molestar a la pantalla', async () => {
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

  it('una oferta sin practicas lo dice en vez de ofrecer un formulario vacio', async () => {
    const fixture = await montar(true, [], []);
    expect(texto(fixture)).toContain('no declara practicas');
    expect(fixture.nativeElement.querySelector('#tratamiento-practica')).toBeNull();
  });

  it('cerrada se lee sin formulario, sin practicas ni espacios', async () => {
    const fixture = await montar(false, [REGISTRADO]);
    expect(texto(fixture)).toContain('Electroterapia');
    expect(texto(fixture)).toContain('15 minutos');
    expect(fixture.nativeElement.querySelector('#tratamiento-practica')).toBeNull();
  });

  it('avisa la lateralidad sin zona antes de que el servidor la rechace', async () => {
    const fixture = await montar();
    elegir(fixture, '#tratamiento-lateralidad', 'IZQUIERDA');
    expect(texto(fixture)).toContain('sin decir de que zona');
  });

  it('parametroParaEnviar rechaza un texto vacio y un si/no sin elegir', () => {
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
      apretar(fixture, 'Agregar un parametro');
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
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<TratamientosDeSesion>, rotulo: string): void {
    const boton = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim().startsWith(rotulo));
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function texto(fixture: ComponentFixture<TratamientosDeSesion>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
