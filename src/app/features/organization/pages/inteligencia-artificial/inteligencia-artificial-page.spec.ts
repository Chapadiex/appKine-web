import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { EstadoDelMotorResponse } from '../../../../api/generated/model/estado-del-motor-response';
import { FuncionesIaResponse } from '../../../../api/generated/model/funciones-ia-response';
import {
  FuncionIaResponse,
  FuncionIaResponseFuncionEnum as F,
} from '../../../../api/generated/model/funcion-ia-response';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { FuncionesIaStore } from '../../../../core/services/funciones-ia.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import {
  InteligenciaArtificialPage,
  bloquesDelConsentimiento,
} from './inteligencia-artificial-page';

const FUNCIONES = '/api/v1/organizations/1/ia';
const MOTOR = '/api/v1/organizations/1/ia/motor';

const f = (
  funcion: F,
  despliegue: boolean,
  centro: boolean,
  activa: boolean,
): FuncionIaResponse => ({
  funcion,
  despliegue,
  centro,
  activa,
});

/**
 * Asistente activo; evolucion apagada por el centro; sugerencias prendida pero sin evolucion;
 * biblioteca sin ofrecer por el servidor.
 */
const LEIDAS: FuncionesIaResponse = {
  organizationId: 1,
  version: 4,
  funciones: [
    f(F.ASISTENTE, true, true, true),
    f(F.EVOLUCION, true, false, false),
    f(F.SUGERENCIAS, true, true, false),
    f(F.BIBLIOTECA, false, true, false),
  ],
  consentimiento: { exigido: false, aceptado: false },
};

const PENDIENTE: FuncionesIaResponse = {
  ...LEIDAS,
  funciones: LEIDAS.funciones.map((x) => ({ ...x, activa: false })),
  consentimiento: { exigido: true, aceptado: false, versionVigente: '2026-11-26' },
};

const TEXTO = {
  version: '2026-11-26',
  texto: 'El centro es responsable.\n\n- Autoriza a AKINE.\n- Cuenta con el consentimiento.',
};

const MOTOR_EN_GPU: EstadoDelMotorResponse = {
  alcanzable: true,
  url: 'http://ollama:11434',
  modelos: [
    {
      nombre: 'qwen3:4b-instruct',
      funciones: ['ASISTENTE'],
      descargado: true,
      cargado: true,
      ejecucion: 'GPU',
      memoriaMb: 4096,
      memoriaGpuMb: 4096,
    },
  ],
};

describe('InteligenciaArtificialPage', () => {
  let fixture: ComponentFixture<InteligenciaArtificialPage>;
  let httpMock: HttpTestingController;
  const adoptar = vi.fn();

  const raiz = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const interruptor = (funcion: string): HTMLInputElement =>
    raiz().querySelector<HTMLInputElement>(`#ia-${funcion}`)!;
  const estadoDe = (funcion: string): string =>
    interruptor(funcion).closest('.ia__funcion')!.querySelector('.ia__estado')!.textContent!.trim();
  const boton = (texto: string): HTMLButtonElement =>
    Array.from(raiz().querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.trim() === texto,
    )!;

  beforeEach(async () => {
    adoptar.mockClear();
    await TestBed.configureTestingModule({
      imports: [InteligenciaArtificialPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
        provideRouter([]),
        { provide: PermissionsStore, useValue: { tiene: () => true } },
        { provide: FuncionesIaStore, useValue: { adoptar } },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({ organizationId: 1, organizationName: 'Centro A' });
    fixture = TestBed.createComponent(InteligenciaArtificialPage);
    await fixture.whenStable();
    httpMock.expectOne(FUNCIONES).flush(LEIDAS);
    httpMock.expectOne(MOTOR).flush(MOTOR_EN_GPU);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  it(
    'pinta las cuatro funciones con su estado y deshabilita la que el servidor no ofrece',
    async () => {
      expect(estadoDe('ASISTENTE')).toBe('Activa');
      expect(estadoDe('EVOLUCION')).toBe('Apagada para el centro');
      expect(estadoDe('SUGERENCIAS')).toBe('Necesita Evolución del caso y Biblioteca del centro');
      expect(estadoDe('BIBLIOTECA')).toBe('No disponible en el servidor');

      expect(interruptor('BIBLIOTECA').disabled).toBe(true);
      expect(interruptor('ASISTENTE').disabled).toBe(false);
      expect(interruptor('EVOLUCION').checked).toBe(false);

      await esperarSinViolaciones(raiz());
    },
    TIMEOUT_AXE,
  );

  it('al tocar un interruptor manda los cuatro booleanos con la version y adopta lo guardado', async () => {
    const evolucion = interruptor('EVOLUCION');
    evolucion.checked = true;
    evolucion.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    const put = httpMock.expectOne({ method: 'PUT', url: FUNCIONES });
    expect(put.request.body).toEqual({
      asistente: true,
      evolucion: true,
      sugerencias: true,
      biblioteca: true,
      version: 4,
    });
    // Mientras guarda, ningun otro interruptor se puede tocar.
    expect(interruptor('ASISTENTE').disabled).toBe(true);

    const guardadas: FuncionesIaResponse = {
      ...LEIDAS,
      version: 5,
      funciones: [
        f(F.ASISTENTE, true, true, true),
        f(F.EVOLUCION, true, true, true),
        f(F.SUGERENCIAS, true, true, false),
        f(F.BIBLIOTECA, false, true, false),
      ],
    };
    put.flush(guardadas);
    await fixture.whenStable();

    expect(adoptar).toHaveBeenCalledWith(guardadas);
    expect(estadoDe('EVOLUCION')).toBe('Activa');
    expect(estadoDe('SUGERENCIAS')).toBe('Necesita Biblioteca del centro');
  });

  it('un 409 concurrent-modification avisa y recarga lo ultimo', async () => {
    const asistente = interruptor('ASISTENTE');
    asistente.checked = false;
    asistente.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    httpMock
      .expectOne({ method: 'PUT', url: FUNCIONES })
      .flush(
        { type: 'https://akine.app/problems/concurrent-modification', status: 409 },
        { status: 409, statusText: 'Conflict' },
      );
    // La relectura llega despues de un render, como con la red real.
    await fixture.whenStable();
    httpMock.expectOne({ method: 'GET', url: FUNCIONES }).flush({ ...LEIDAS, version: 7 });
    await fixture.whenStable();

    expect(raiz().textContent).toContain('Otra persona cambió esta configuración recién');
    expect(adoptar).not.toHaveBeenCalled();
    expect(interruptor('ASISTENTE').checked).toBe(true);
  });

  it('el motor muestra donde corre y "Probar" muestra los segundos', async () => {
    expect(raiz().textContent).toContain('En GPU');
    expect(raiz().querySelector('tbody')!.textContent).toContain('GPU');

    boton('Probar').click();
    await fixture.whenStable();
    httpMock
      .expectOne({ method: 'POST', url: `${MOTOR}/prueba` })
      .flush({ ok: true, milisegundos: 2350, modelo: 'qwen3:4b-instruct' });
    httpMock.expectOne(MOTOR).flush({
      ...MOTOR_EN_GPU,
      modelos: [{ ...MOTOR_EN_GPU.modelos[0], ejecucion: 'CPU' }],
    });
    await fixture.whenStable();

    expect(raiz().textContent).toContain('Tardó 2,4 s.');
    expect(raiz().textContent).toContain('CPU (lento)');
    expect(raiz().textContent).not.toContain('En GPU');
  });

  describe('consentimiento de IA', () => {
    const pendiente = async (): Promise<void> => {
      (fixture.componentInstance as unknown as { cargar(): void }).cargar();
      httpMock.expectOne(FUNCIONES).flush(PENDIENTE);
      await fixture.whenStable();
      httpMock.expectOne(`${FUNCIONES}/consentimiento`).flush(TEXTO);
      await fixture.whenStable();
    };

    it('sin consentimiento muestra el texto y deshabilita los interruptores', async () => {
      await pendiente();

      expect(raiz().textContent).toContain('Consentimiento para usar inteligencia artificial');
      expect(raiz().querySelectorAll('.ia__texto-legal li')).toHaveLength(2);
      expect(interruptor('ASISTENTE').disabled).toBe(true);
      expect(estadoDe('ASISTENTE')).toBe('Falta el consentimiento');
    });

    it('aceptar manda la version leida y adopta lo que devuelve', async () => {
      await pendiente();

      boton('Acepto en nombre del centro').click();
      await fixture.whenStable();
      const post = httpMock.expectOne({ method: 'POST', url: `${FUNCIONES}/consentimiento` });
      expect(post.request.body).toEqual({ version: '2026-11-26' });
      const aceptado: FuncionesIaResponse = {
        ...LEIDAS,
        consentimiento: {
          exigido: true,
          aceptado: true,
          versionVigente: '2026-11-26',
          aceptadoPor: 'Ana Gomez',
          aceptadoAt: '2026-11-26T13:00:00Z',
        },
      };
      post.flush(aceptado);
      await fixture.whenStable();

      expect(adoptar).toHaveBeenCalledWith(aceptado);
      expect(raiz().textContent).not.toContain('Acepto en nombre del centro');
      expect(raiz().textContent).toContain('Consentimiento aceptado');
      expect(raiz().textContent).toContain('Ana Gomez');
    });

    it('parte el texto en parrafos y listas', () => {
      expect(bloquesDelConsentimiento(TEXTO.texto)).toEqual([
        { tipo: 'parrafo', texto: 'El centro es responsable.' },
        { tipo: 'lista', items: ['Autoriza a AKINE.', 'Cuenta con el consentimiento.'] },
      ]);
    });
  });
});
