import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DerivarParticipante, ReintentoConMotivo } from './derivar-participante';
import { provideApi } from '../../../../api/generated/provide-api';
import { DerivacionDeParticipante } from '../../../../api/generated/model/derivacion-de-participante';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';

const CONSULTORIO = 3;
const CLASE = 40;
const MARIA = 71;
const PERSONA = 501;
const OFERTA = 12;
const BASE = `/api/v1/consultorios/${CONSULTORIO}/clases/${CLASE}/inscripciones/${MARIA}`;
const ELEGIBILIDAD = `${BASE}/elegibilidad-clinica`;
const DERIVAR = `${BASE}/derivaciones`;
const DATOS = `/api/v1/historias-clinicas/por-persona/${PERSONA}/datos-administrativos`;

const DERIVABLE = {
  inscripcionId: MARIA,
  asistenciaId: 1,
  personaId: PERSONA,
  derivable: true,
  ofertaClinica: true,
  esPacienteVigente: true,
  requiereActivarPerfil: false,
  requiereCasoClinico: true,
  resultadoAsistencia: 'PRESENTE',
  motivos: [],
};

/** Dos activos y uno cerrado: el cerrado no se ofrece. */
const DOS_CASOS = {
  personaId: PERSONA,
  tieneHistoriaClinica: true,
  historiaClinicaId: 60,
  casos: [
    { id: 7, numeroCaso: 1, estado: 'ACTIVO', ofertaId: 99, abiertoEn: '2026-09-01T13:00:00Z' },
    { id: 8, numeroCaso: 2, estado: 'ACTIVO', ofertaId: OFERTA, abiertoEn: '2026-10-01T13:00:00Z' },
    { id: 9, numeroCaso: 3, estado: 'CERRADO', ofertaId: OFERTA },
  ],
};

/**
 * Spec de la tarjeta para derivar a un participante (AKINE-08.04).
 *
 * <p>Lo que decide comportamiento: que muestra el veredicto y sus bloqueos sin leer nada clinico,
 * que solo ofrece casos ACTIVOS por su numero —nunca su id—, que exige elegir uno, que manda lo
 * que el contrato pide, y que el motivo de acceso se le pide al panel y se reintenta con el.
 */
describe('DerivarParticipante', () => {
  let http: HttpTestingController;
  let derivadas: DerivacionDeParticipante[];
  let pedidosDeMotivo: ReintentoConMotivo[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DerivarParticipante],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    derivadas = [];
    pedidosDeMotivo = [];
  });

  afterEach(() => http.verify());

  it('muestra el veredicto y ofrece solo los casos activos, por su numero', async () => {
    const fixture = await montar();
    http.expectOne(DATOS).flush(DOS_CASOS);
    await estabilizar(fixture);

    const todo = texto(fixture);
    expect(todo).toContain('Presente');
    expect(todo).toContain('Sí, con perfil de paciente');
    expect(todo).toContain('Con 2 casos activos');
    expect(todo).toContain('Caso clinico 1');
    expect(todo).toContain('Caso clinico 2');
    expect(todo).toContain('de la oferta de esta clase');
    expect(todo).not.toContain('Caso clinico 3');
    expect(radios(fixture)).toHaveLength(2);
    // Con dos no elige por nadie.
    expect(radios(fixture).some((r) => r.checked)).toBe(false);
  });

  it('sin elegir caso no deriva; elegido, manda el caso y el motivo y avisa', async () => {
    const fixture = await montar();
    http.expectOne(DATOS).flush(DOS_CASOS);
    await estabilizar(fixture);

    enviar(fixture);
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Elegí a qué caso se deriva');
    http.expectNone(DERIVAR);

    radios(fixture)[1].click();
    escribir(fixture, '#derivar-motivo', '  Rehabilitacion de rodilla  ');
    enviar(fixture);
    const pedido = http.expectOne((r) => r.method === 'POST' && r.url === DERIVAR);
    expect(pedido.request.body).toEqual({ casoClinicoId: 8, motivo: 'Rehabilitacion de rodilla' });
    expect(pedido.request.headers.has('X-Justificacion-Acceso')).toBe(false);
    pedido.flush({ id: 30, casoClinicoId: 8, numeroCaso: 2, estado: 'VIGENTE' });
    await estabilizar(fixture);
    expect(derivadas.map((d) => d.id)).toEqual([30]);
  });

  it('con un solo caso activo lo deja elegido, y sin motivo no lo manda', async () => {
    const fixture = await montar({ motivo: 'Cubro a la profesional' });
    http.expectOne(DATOS).flush({ ...DOS_CASOS, casos: [DOS_CASOS.casos[0]] });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Con 1 caso activo');
    expect(radios(fixture)[0].checked).toBe(true);

    enviar(fixture);
    const pedido = http.expectOne((r) => r.method === 'POST' && r.url === DERIVAR);
    expect(pedido.request.body).toEqual({ casoClinicoId: 7 });
    // El motivo de acceso que el panel ya junto viaja en la cabecera.
    expect(pedido.request.headers.get('X-Justificacion-Acceso')).toBe('Cubro a la profesional');
    pedido.flush({ id: 30, casoClinicoId: 7, numeroCaso: 1, estado: 'VIGENTE' });
    await estabilizar(fixture);
    expect(derivadas).toHaveLength(1);
  });

  it('no derivable: dice por que y no lee sus casos', async () => {
    const fixture = await montar({
      elegibilidad: {
        ...DERIVABLE,
        derivable: false,
        resultadoAsistencia: 'AUSENTE',
        motivos: ['AUSENTE', 'CODIGO_NUEVO'],
      },
    });
    http.expectNone(DATOS);
    const todo = texto(fixture);
    expect(todo).toContain('No se puede derivar');
    expect(todo).toContain('Figura ausente');
    // Un bloqueo que la pantalla no conoce se muestra tal cual, no se oculta.
    expect(todo).toContain('CODIGO_NUEVO');
    expect(botones(fixture, /Derivar al caso/)).toHaveLength(0);
  });

  it('una oferta no clinica lo dice', async () => {
    const fixture = await montar({
      elegibilidad: {
        ...DERIVABLE,
        derivable: false,
        ofertaClinica: false,
        motivos: ['OFERTA_NO_CLINICA'],
      },
    });
    expect(texto(fixture)).toContain('no genera registro clínico');
  });

  it('sin perfil de paciente no lee casos y lleva a su ficha del padron', async () => {
    const fixture = await montar({
      elegibilidad: { ...DERIVABLE, esPacienteVigente: false, requiereActivarPerfil: true },
    });
    http.expectNone(DATOS);
    expect(texto(fixture)).toContain('Todavía no es paciente');
    expect(enlace(fixture, `/pacientes/${PERSONA}`)).not.toBeNull();
  });

  it('sin historia o sin caso activo lleva a su historia clinica', async () => {
    const fixture = await montar();
    http.expectOne(DATOS).flush({ personaId: PERSONA, tieneHistoriaClinica: false, casos: [] });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('Todavía no tiene historia clínica.');
    expect(enlace(fixture, `/historia-clinica/personas/${PERSONA}`)).not.toBeNull();
    expect(botones(fixture, /Derivar al caso/)).toHaveLength(0);
  });

  it('con historia y todos los casos cerrados dice que no tiene activos', async () => {
    const fixture = await montar();
    http.expectOne(DATOS).flush({ ...DOS_CASOS, casos: [DOS_CASOS.casos[2]] });
    await estabilizar(fixture);
    expect(texto(fixture)).toContain('No tiene ningún caso clínico activo.');
  });

  it('un 409 del backend se muestra con su texto propio', async () => {
    const fixture = await montar();
    http.expectOne(DATOS).flush(DOS_CASOS);
    await estabilizar(fixture);
    radios(fixture)[0].click();
    enviar(fixture);
    problema(http.expectOne(DERIVAR), 409, 'caso-no-activo');
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('El caso elegido ya no está activo');
    expect(derivadas).toHaveLength(0);
  });

  it('si pide motivo de acceso se lo pide al panel y reintenta con el declarado', async () => {
    const fixture = await montar();
    http.expectOne(DATOS).flush(DOS_CASOS);
    await estabilizar(fixture);
    radios(fixture)[0].click();
    enviar(fixture);
    problema(http.expectOne(DERIVAR), 403, 'justificacion-de-acceso-requerida');
    await estabilizar(fixture);
    expect(pedidosDeMotivo).toHaveLength(1);

    pedidosDeMotivo[0]('Reemplazo a la profesional');
    const reintento = http.expectOne(DERIVAR);
    expect(reintento.request.headers.get('X-Justificacion-Acceso')).toBe(
      'Reemplazo a la profesional',
    );
    expect(reintento.request.body).toEqual({ casoClinicoId: 7 });
    reintento.flush({ id: 31, casoClinicoId: 7, estado: 'VIGENTE', yaExistia: true });
    await estabilizar(fixture);
    expect(derivadas.map((d) => d.id)).toEqual([31]);
  });

  it('un 403 sin permiso dice que pide derivar', async () => {
    const fixture = await montar();
    http.expectOne(DATOS).flush(DOS_CASOS);
    await estabilizar(fixture);
    radios(fixture)[0].click();
    enviar(fixture);
    http
      .expectOne(DERIVAR)
      .flush(
        { type: 'about:blank', status: 403, detail: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('No tenes permiso para derivar');
  });

  it('si la elegibilidad falla lo dice y se puede reintentar', async () => {
    const fixture = TestBed.createComponent(DerivarParticipante);
    asignar(fixture);
    fixture.detectChanges();
    problema(http.expectOne(ELEGIBILIDAD), 404, 'not-found');
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('no existen en esta sede');

    boton(fixture, /Reintentar/).click();
    http.expectOne(ELEGIBILIDAD).flush(DERIVABLE);
    http.expectOne(DATOS).flush(DOS_CASOS);
    await estabilizar(fixture);
    expect(radios(fixture)).toHaveLength(2);
  });

  it('si los casos no se pueden leer lo dice', async () => {
    const fixture = await montar();
    http
      .expectOne(DATOS)
      .flush(
        { type: 'about:blank', status: 403, detail: 'x' },
        { status: 403, statusText: 'Forbidden' },
      );
    await estabilizar(fixture);
    expect(alerta(fixture)).toContain('No tenes permiso para derivar');
  });

  it('cerrar avisa al panel', async () => {
    const fixture = await montar();
    http.expectOne(DATOS).flush(DOS_CASOS);
    await estabilizar(fixture);
    let cerro = false;
    fixture.componentInstance.cerrar.subscribe(() => (cerro = true));
    boton(fixture, /^Cerrar$/).click();
    expect(cerro).toBe(true);
  });

  it(
    'sin violaciones de accesibilidad con los casos y el error de eleccion',
    async () => {
      const fixture = await montar();
      http.expectOne(DATOS).flush(DOS_CASOS);
      await estabilizar(fixture);
      enviar(fixture);
      await estabilizar(fixture);
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  // ------------------------------------------------------------------ apoyo

  async function montar(
    opciones: { elegibilidad?: object; motivo?: string } = {},
  ): Promise<ComponentFixture<DerivarParticipante>> {
    const fixture = TestBed.createComponent(DerivarParticipante);
    asignar(fixture, opciones.motivo ?? null);
    fixture.detectChanges();
    http.expectOne(ELEGIBILIDAD).flush(opciones.elegibilidad ?? DERIVABLE);
    await estabilizar(fixture);
    return fixture;
  }

  function asignar(fixture: ComponentFixture<DerivarParticipante>, motivo: string | null = null) {
    fixture.componentRef.setInput('consultorioId', CONSULTORIO);
    fixture.componentRef.setInput('claseId', CLASE);
    fixture.componentRef.setInput('inscripcionId', MARIA);
    fixture.componentRef.setInput('nombre', 'Sintetica, Maria');
    fixture.componentRef.setInput('motivo', motivo);
    fixture.componentRef.setInput('ofertaId', OFERTA);
    fixture.componentInstance.derivado.subscribe((d) => derivadas.push(d));
    fixture.componentInstance.pideMotivo.subscribe((r) => pedidosDeMotivo.push(r));
  }

  async function estabilizar(fixture: ComponentFixture<DerivarParticipante>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function problema(pedido: TestRequest, status: number, tipo: string): void {
    pedido.flush(
      { type: `https://akine.app/problems/${tipo}`, status, detail: 'texto del servidor' },
      { status, statusText: 'Error' },
    );
  }

  function raiz(fixture: ComponentFixture<DerivarParticipante>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function texto(fixture: ComponentFixture<DerivarParticipante>): string {
    return (raiz(fixture).textContent ?? '').replace(/\s+/g, ' ');
  }

  function alerta(fixture: ComponentFixture<DerivarParticipante>): string {
    return Array.from(
      raiz(fixture).querySelectorAll('[role="alert"]'),
      (el) => el.textContent ?? '',
    ).join(' ');
  }

  function radios(fixture: ComponentFixture<DerivarParticipante>): HTMLInputElement[] {
    return Array.from(raiz(fixture).querySelectorAll('input[type="radio"]'));
  }

  function enlace(fixture: ComponentFixture<DerivarParticipante>, href: string): Element | null {
    return raiz(fixture).querySelector(`a[href="${href}"]`);
  }

  function botones(
    fixture: ComponentFixture<DerivarParticipante>,
    nombre: RegExp,
  ): HTMLButtonElement[] {
    return Array.from(raiz(fixture).querySelectorAll('button')).filter((b) =>
      nombre.test((b.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
  }

  function boton(fixture: ComponentFixture<DerivarParticipante>, nombre: RegExp) {
    const encontrado = botones(fixture, nombre)[0];
    if (encontrado === undefined) {
      throw new Error(`No hay boton ${nombre}`);
    }
    return encontrado;
  }

  function enviar(fixture: ComponentFixture<DerivarParticipante>): void {
    raiz(fixture)
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
  }

  function escribir(
    fixture: ComponentFixture<DerivarParticipante>,
    selector: string,
    valor: string,
  ): void {
    const campo = raiz(fixture).querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
});
