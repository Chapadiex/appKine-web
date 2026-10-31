import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../api/generated/provide-api';
import {
  PersonaResponse,
  PersonaResponseTipoDocumentoEnum,
} from '../../../api/generated/model/persona-response';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import { PERMISO_PACIENTE_MANAGE } from '../../../core/models/permisos';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../core/testing/rutas-api';
import { BuscadorDePaciente } from './buscador-de-paciente';

const PERSONAS = '/api/v1/personas';
const perfil = (id: number) => `${PERSONAS}/${id}/perfil-paciente`;

const ANA: PersonaResponse = {
  id: 12,
  nombre: 'Ana',
  apellido: 'Perez',
  tipoDocumento: PersonaResponseTipoDocumentoEnum.DNI,
  numeroDocumento: '30111222',
  telefono: '3514000000',
  esPaciente: true,
};

/** La búsqueda espera 300 ms de teclado antes de salir: lo que se prueba es esa espera real. */
const esperarBusqueda = (): Promise<void> => new Promise((listo) => setTimeout(listo, 350));

/**
 * Buscar a quién se le da el turno y darlo de alta sin salir del flujo. Lo que decide: una respuesta
 * vieja no pisa a la nueva, y el alta son dos llamadas que pueden fallar por separado.
 */
describe('BuscadorDePaciente', () => {
  let httpMock: HttpTestingController;
  let elegidas: PersonaResponse[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BuscadorDePaciente],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    elegidas = [];
  });

  afterEach(() => httpMock.verify());

  it(
    'busca por teclazo, la respuesta vieja no pisa a la nueva y al elegir avisa',
    async () => {
      const fixture = await montar();

      escribir(fixture, 'Per');
      await esperarBusqueda();
      const vieja = buscando('Per');

      escribir(fixture, 'Perez');
      await esperarBusqueda();
      expect(vieja.cancelled).toBe(true);
      const nueva = buscando('Perez');
      expect(nueva.request.params.get('perfil')).toBe('TODOS');
      nueva.flush({ content: [ANA] });
      await asentar(fixture);

      const candidato = raiz(fixture).querySelector<HTMLButtonElement>('.candidato');
      expect(candidato?.textContent).toContain('Perez, Ana');
      expect(candidato?.textContent).toContain('DNI 30111222');
      expect(candidato?.textContent).toContain('3514000000');
      await esperarSinViolaciones(raiz(fixture));

      candidato?.click();
      expect(elegidas).toEqual([ANA]);
    },
    TIMEOUT_AXE,
  );

  it('borrar el texto limpia la lista sin ir al servidor', async () => {
    const fixture = await montar();
    escribir(fixture, 'Perez');
    await esperarBusqueda();
    buscando('Perez').flush({ content: [ANA] });
    await asentar(fixture);

    escribir(fixture, '');
    await esperarBusqueda();
    httpMock.expectNone((r) => r.url === PERSONAS);
    await asentar(fixture);

    expect(raiz(fixture).querySelector('.candidato')).toBeNull();
    expect(raiz(fixture).textContent).not.toContain('No encontramos pacientes');
  });

  it('si la búsqueda falla lo dice con el mensaje del servidor', async () => {
    const fixture = await montar();
    escribir(fixture, 'Perez');
    await esperarBusqueda();
    buscando('Perez').flush(
      { type: 'https://akine.app/problems/forbidden', status: 403, detail: 'Sin permiso' },
      { status: 403, statusText: 'F' },
    );
    await asentar(fixture);

    expect(raiz(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'No tenés permiso',
    );
  });

  it('sin permiso de padrón no ofrece crear paciente', async () => {
    const fixture = await montar([]);
    escribir(fixture, 'Perez');
    await esperarBusqueda();
    buscando('Perez').flush({ content: [] });
    await asentar(fixture);

    expect(raiz(fixture).textContent).toContain('No encontramos pacientes');
    expect(boton(fixture, 'Crear paciente')).toBeUndefined();
  });

  it('el alta rápida precarga lo tipeado y hace las dos llamadas: persona y perfil', async () => {
    const fixture = await abrirAlta('Perez Ana Maria');

    expect(valor(fixture, '#flujo-alta-apellido')).toBe('Perez');
    expect(valor(fixture, '#flujo-alta-nombre')).toBe('Ana Maria');

    completar(fixture, '#flujo-alta-dni', ' 30111222 ');
    completar(fixture, '#flujo-alta-telefono', '3514000000');
    enviar(fixture);

    const alta = httpMock.expectOne((r) => r.url === PERSONAS && r.method === 'POST');
    expect(alta.request.body).toEqual({
      nombre: 'Ana Maria',
      apellido: 'Perez',
      tipoDocumento: 'DNI',
      numeroDocumento: '30111222',
      telefono: '3514000000',
    });
    alta.flush({ ...ANA, esPaciente: false });

    // El turno exige el perfil: la segunda llamada va sola, sin que nadie la pida.
    const activacion = httpMock.expectOne(perfil(12));
    expect(activacion.request.method).toBe('POST');
    activacion.flush(ANA);
    expect(elegidas).toEqual([ANA]);
  });

  it('con un número tipeado lo precarga como documento', async () => {
    const fixture = await abrirAlta('30111222');

    expect(valor(fixture, '#flujo-alta-dni')).toBe('30111222');
    expect(valor(fixture, '#flujo-alta-apellido')).toBe('');
  });

  it('con datos incompletos avisa y no manda nada', async () => {
    const fixture = await abrirAlta('Perez');

    enviar(fixture);
    await asentar(fixture);

    expect(raiz(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'Completá nombre, apellido, DNI y teléfono',
    );
    httpMock.expectNone((r) => r.url === PERSONAS && r.method === 'POST');
  });

  it('documento repetido: ofrece usar la persona que ya existe y la activa si hace falta', async () => {
    const fixture = await altaLista();
    enviar(fixture);

    httpMock
      .expectOne((r) => r.url === PERSONAS && r.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/persona-documento-taken',
          status: 409,
          personaExistenteId: 77,
        },
        { status: 409, statusText: 'C' },
      );
    httpMock.expectOne(`${PERSONAS}/77`).flush({ ...ANA, id: 77, esPaciente: false });
    await asentar(fixture);

    expect(raiz(fixture).textContent).toContain('Ya hay una persona con ese documento.');
    boton(fixture, 'Usar Perez, Ana')?.click();

    httpMock.expectOne(perfil(77)).flush({ ...ANA, id: 77 });
    expect(elegidas.map((p) => p.id)).toEqual([77]);
  });

  it('la que ya es paciente se usa directo, sin activarla de nuevo', async () => {
    const fixture = await altaLista();
    enviar(fixture);

    httpMock
      .expectOne((r) => r.url === PERSONAS && r.method === 'POST')
      .flush(
        {
          type: 'https://akine.app/problems/persona-documento-taken',
          status: 409,
          personaExistenteId: 77,
        },
        { status: 409, statusText: 'C' },
      );
    httpMock.expectOne(`${PERSONAS}/77`).flush({ ...ANA, id: 77 });
    await asentar(fixture);

    boton(fixture, 'Usar Perez, Ana')?.click();
    expect(elegidas.map((p) => p.id)).toEqual([77]);
  });

  it('una persona parecida se confirma a mano y el reintento lo declara', async () => {
    const fixture = await altaLista();
    enviar(fixture);

    httpMock
      .expectOne((r) => r.url === PERSONAS && r.method === 'POST')
      .flush(
        { type: 'https://akine.app/problems/persona-posible-duplicado', status: 409 },
        { status: 409, statusText: 'C' },
      );
    await asentar(fixture);
    expect(raiz(fixture).textContent).toContain('Hay una persona muy parecida');

    boton(fixture, 'Es otra persona: crearla igual')?.click();

    const reintento = httpMock.expectOne((r) => r.url === PERSONAS && r.method === 'POST');
    expect(reintento.request.body.confirmaPosibleDuplicado).toBe(true);
    reintento.flush({ ...ANA, esPaciente: false });
    httpMock.expectOne(perfil(12)).flush(ANA);
    expect(elegidas).toEqual([ANA]);
  });

  it('si falla la activación la persona ya existe: se dice y el reintento solo activa', async () => {
    const fixture = await altaLista();
    enviar(fixture);

    httpMock
      .expectOne((r) => r.url === PERSONAS && r.method === 'POST')
      .flush({ ...ANA, esPaciente: false });
    httpMock
      .expectOne(perfil(12))
      .flush({ status: 500, detail: 'Falló' }, { status: 500, statusText: 'E' });
    await asentar(fixture);
    expect(raiz(fixture).textContent).toContain(
      'La persona se creó, pero no pudimos activarla como paciente',
    );

    boton(fixture, 'Usar Perez, Ana')?.click();

    httpMock.expectOne(perfil(12)).flush(ANA);
    httpMock.expectNone((r) => r.url === PERSONAS && r.method === 'POST');
    expect(elegidas).toEqual([ANA]);
  });

  it('otro error del alta se muestra y "Volver" regresa a la búsqueda', async () => {
    const fixture = await altaLista();
    enviar(fixture);

    httpMock
      .expectOne((r) => r.url === PERSONAS && r.method === 'POST')
      .flush({ status: 400, detail: 'El teléfono no es válido' }, { status: 400, statusText: 'B' });
    await asentar(fixture);
    expect(raiz(fixture).textContent).toContain('El teléfono no es válido');

    boton(fixture, 'Volver')?.click();
    await asentar(fixture);
    expect(raiz(fixture).querySelector('#flujo-paciente')).not.toBeNull();
  });

  // -------------------------------------------------------------------------------------

  async function montar(
    permisos: readonly string[] = [PERMISO_PACIENTE_MANAGE],
  ): Promise<ComponentFixture<BuscadorDePaciente>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: permisos });

    const fixture = TestBed.createComponent(BuscadorDePaciente);
    fixture.componentInstance.elegida.subscribe((persona) => elegidas.push(persona));
    await asentar(fixture);
    return fixture;
  }

  async function abrirAlta(texto: string): Promise<ComponentFixture<BuscadorDePaciente>> {
    const fixture = await montar();
    escribir(fixture, texto);
    await esperarBusqueda();
    buscando(texto).flush({ content: [] });
    await asentar(fixture);
    boton(fixture, 'Crear paciente')?.click();
    await asentar(fixture);
    return fixture;
  }

  async function altaLista(): Promise<ComponentFixture<BuscadorDePaciente>> {
    const fixture = await abrirAlta('Perez Ana');
    completar(fixture, '#flujo-alta-dni', '30111222');
    completar(fixture, '#flujo-alta-telefono', '3514000000');
    return fixture;
  }

  function buscando(texto: string) {
    return httpMock.expectOne(
      // El cliente generado encodea los parametros: el espacio viaja como %20.
      (r) =>
        r.url === PERSONAS &&
        r.method === 'GET' &&
        decodeURIComponent(r.params.get('q') ?? '') === texto,
    );
  }

  function raiz(fixture: ComponentFixture<BuscadorDePaciente>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function boton(
    fixture: ComponentFixture<BuscadorDePaciente>,
    texto: string,
  ): HTMLButtonElement | undefined {
    return Array.from(raiz(fixture).querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === texto,
    );
  }

  function escribir(fixture: ComponentFixture<BuscadorDePaciente>, texto: string): void {
    const campo = raiz(fixture).querySelector('#flujo-paciente') as HTMLInputElement;
    campo.value = texto;
    campo.dispatchEvent(new Event('input'));
  }

  function completar(
    fixture: ComponentFixture<BuscadorDePaciente>,
    selector: string,
    texto: string,
  ): void {
    const campo = raiz(fixture).querySelector(selector) as HTMLInputElement;
    campo.value = texto;
    campo.dispatchEvent(new Event('input'));
  }

  function valor(fixture: ComponentFixture<BuscadorDePaciente>, selector: string): string {
    return (raiz(fixture).querySelector(selector) as HTMLInputElement).value;
  }

  function enviar(fixture: ComponentFixture<BuscadorDePaciente>): void {
    (raiz(fixture).querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
  }

  async function asentar(fixture: ComponentFixture<BuscadorDePaciente>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
