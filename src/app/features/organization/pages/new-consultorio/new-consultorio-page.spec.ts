import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NewConsultorioPage } from './new-consultorio-page';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const RUTA_ALTA = '/api/v1/organizations/1/consultorios';

/**
 * Spec del alta de sede (M01, AKINE-02.01).
 *
 * <p>Se cubre lo que solo se rompe en produccion y en silencio:
 *
 * <ol>
 *   <li><b>La clave de idempotencia entre reintentos.</b> Si el reintento tras un corte de
 *       red va con una clave nueva, el backend crea una segunda sede: el bug produce datos
 *       duplicados y ningun error. Y si el usuario cambia el cuerpo y la clave se reusa, el
 *       backend responde `409` para siempre y el alta queda trabada.</li>
 *   <li><b>El tope del plan.</b> Es el error que mas se va a ver del modulo -el plan del alta
 *       self-service permite una sola sede- y tiene que leerse como un limite del plan
 *       contratado, con salida a la suscripcion, no como una falla tecnica.</li>
 * </ol>
 */
describe('NewConsultorioPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewConsultorioPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
    });
  });

  afterEach(() => httpMock.verify());

  it('el reintento con el mismo cuerpo reusa la clave; cambiar el cuerpo genera una nueva', async () => {
    const fixture = montar();

    escribir(fixture, '#sede-name', 'Sede Norte');
    enviar(fixture);

    // Paso 2: se envia y el request se pierde en el camino (status 0 = nunca llego).
    enviar(fixture);
    const primero = httpMock.expectOne(RUTA_ALTA);
    const clave = primero.request.headers.get('Idempotency-Key');
    expect(clave).toBeTruthy();
    primero.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No se pudo contactar al servidor');

    // Reintento sin tocar nada: MISMA clave. Es lo unico que impide que un timeout de red
    // termine en dos sedes iguales, porque el cliente no sabe si el primero llego.
    enviar(fixture);
    const segundo = httpMock.expectOne(RUTA_ALTA);
    expect(segundo.request.headers.get('Idempotency-Key')).toBe(clave);
    segundo.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    // Ahora el usuario corrige el nombre: es otra alta, no un reintento. Reusar la clave
    // daria 409 idempotency-key-conflict y dejaria el formulario trabado para siempre.
    escribir(fixture, '#sede-contactEmail', 'sede.norte@ejemplo.test');
    enviar(fixture);
    const tercero = httpMock.expectOne(RUTA_ALTA);
    expect(tercero.request.headers.get('Idempotency-Key')).not.toBe(clave);

    // El replay responde 201 con la MISMA sede: se muestra el exito una sola vez, sin
    // avisar de un duplicado que no existe.
    tercero.flush(
      { id: 9, name: 'Sede Norte', estado: 'ACTIVO' },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('La sede "Sede Norte" quedo creada');
  });

  /**
   * Escribir una duracion y despues borrarla NO es pedir turnos de cero minutos.
   *
   * <p>El `NumberValueAccessor` escribe `null` en el control cuando el `<input type="number">`
   * queda vacio, y la guarda vieja —`valores.slotMinutes !== ''`— lo dejaba pasar: `Number(null)`
   * es `0` y `Number.isFinite(0)` es verdadero, asi que el alta viajaba con `slotMinutes: 0`.
   * `Validators.min(1)` no lo frena porque un control vacio le resulta valido.
   */
  it('borrar la duracion del turno la omite del alta en vez de mandarla en cero', async () => {
    const fixture = montar();

    escribir(fixture, '#sede-name', 'Sede Norte');
    escribir(fixture, '#sede-slotMinutes', '30');
    escribir(fixture, '#sede-slotMinutes', '');
    enviar(fixture);
    enviar(fixture);

    const alta = httpMock.expectOne(RUTA_ALTA);
    expect(alta.request.body).toEqual({ name: 'Sede Norte' });

    alta.flush(
      { id: 9, name: 'Sede Norte', estado: 'ACTIVO' },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('el tope del plan se explica con el limite del plan y ofrece cambiarlo', async () => {
    const fixture = montar();

    escribir(fixture, '#sede-name', 'Sede Norte');
    enviar(fixture);
    enviar(fixture);

    httpMock.expectOne(RUTA_ALTA).flush(
      {
        type: 'https://akine.app/problems/plan-limit-exceeded',
        detail: 'Limite MAX_CONSULTORIOS alcanzado',
        limitCode: 'MAX_CONSULTORIOS',
        limitValue: 1,
        currentUsage: 1,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    // No se muestra el `detail` tecnico del backend: se dice que es el plan y cual es la
    // salida. Es el unico caso, junto con la ultima sede, donde el frontend redacta mejor.
    expect(texto(fixture)).toContain('Tu plan actual incluye una sola sede');
    expect(texto(fixture)).toContain('cambiar a un plan');
    expect(
      fixture.nativeElement.querySelector('a[href="/organizacion/suscripcion"]'),
    ).not.toBeNull();
  });

  describe('alta en un acto: primer box y horario general (A-8, CA-M03-002)', () => {
    it('el box y las franjas viajan en el mismo POST, con 24:00 como cierre', async () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      escribir(fixture, '#sede-boxNombre', 'Box 1');
      escribir(fixture, '#sede-boxCapacidad', '2');
      agregarFranja(fixture);
      escribir(fixture, '#sede-horario-desde-0', '09:00');
      escribir(fixture, '#sede-horario-hasta-0', '13:00');
      agregarFranja(fixture);
      escribir(fixture, '#sede-horario-desde-1', '14:00');
      escribir(fixture, '#sede-horario-hasta-1', '24:00');
      enviar(fixture);

      // El resumen del paso 2 dice lo que se va a crear, medianoche incluida.
      expect(texto(fixture)).toContain('Box 1 (capacidad 2)');
      expect(texto(fixture)).toContain('Lunes: 14:00 a medianoche (24:00)');

      enviar(fixture);
      const alta = httpMock.expectOne(RUTA_ALTA);
      expect(alta.request.body).toEqual({
        name: 'Sede Norte',
        primerBox: { name: 'Box 1', capacidad: 2 },
        horarioGeneral: [
          { diaSemana: 1, horaDesde: '09:00', horaHasta: '13:00' },
          { diaSemana: 1, horaDesde: '14:00', horaHasta: '24:00' },
        ],
      });
      alta.flush({ id: 9, name: 'Sede Norte' }, { status: 201, statusText: 'Created' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Se creo junto con su primer box');
      expect(texto(fixture)).toContain('ningun turno se ofrece fuera de ese horario');
    });

    it('dos franjas del mismo dia que se pisan no dejan avanzar', () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      agregarFranja(fixture);
      escribir(fixture, '#sede-horario-desde-0', '09:00');
      escribir(fixture, '#sede-horario-hasta-0', '13:00');
      agregarFranja(fixture);
      escribir(fixture, '#sede-horario-desde-1', '12:00');
      escribir(fixture, '#sede-horario-hasta-1', '18:00');
      enviar(fixture);

      expect(texto(fixture)).toContain('Paso 1 de 2');
      expect(texto(fixture)).toContain('Se pisa con otra franja del mismo dia');
    });

    it('un 400 sobre una franja vuelve al paso 1 y marca esa franja, no un cartel generico', async () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      agregarFranja(fixture);
      escribir(fixture, '#sede-horario-desde-0', '09:00');
      escribir(fixture, '#sede-horario-hasta-0', '13:00');
      agregarFranja(fixture);
      escribir(fixture, '#sede-horario-desde-1', '14:00');
      escribir(fixture, '#sede-horario-hasta-1', '18:00');
      enviar(fixture);
      enviar(fixture);

      httpMock.expectOne(RUTA_ALTA).flush(
        {
          type: 'https://akine.app/problems/validation-error',
          detail: 'La solicitud contiene campos invalidos',
          errors: { 'horarioGeneral[1].horaHasta': 'La hora de cierre tiene que ser HH:mm' },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Paso 1 de 2');
      const error = fixture.nativeElement.querySelector('#sede-horario-error-1');
      expect(error?.textContent).toContain('La hora de cierre tiene que ser HH:mm');
      expect(fixture.nativeElement.querySelector('#sede-horario-error-0')).toBeNull();
    });
  });

  function montar() {
    const fixture = TestBed.createComponent(NewConsultorioPage);
    fixture.detectChanges();
    return fixture;
  }
});

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('input'));
  fixture.detectChanges();
}

function agregarFranja(fixture: { nativeElement: HTMLElement; detectChanges(): void }) {
  const boton = Array.from(fixture.nativeElement.querySelectorAll('button')).find((candidato) =>
    candidato.textContent?.includes('Agregar una franja'),
  );
  if (boton === undefined) {
    throw new Error('No existe el boton para agregar una franja');
  }
  boton.click();
  fixture.detectChanges();
}

/** El unico `form` de la pantalla avanza de paso o envia, segun en cual este. */
function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }) {
  const formulario = fixture.nativeElement.querySelector<HTMLFormElement>('form');
  formulario?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
