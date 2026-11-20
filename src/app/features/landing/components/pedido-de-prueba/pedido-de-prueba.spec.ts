import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { provideApi } from '../../../../api/generated/provide-api';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { EleccionDelArmador } from '../../models/eleccion-del-armador';
import { PedidoDePrueba } from './pedido-de-prueba';

const URL = '/api/v1/public/solicitudes-de-prueba';
const VERSION_TERMINOS = '2026-11-19';

describe('PedidoDePrueba', () => {
  let http: HttpTestingController;
  let eleccion: EleccionDelArmador;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideApi(''),
        EleccionDelArmador,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    eleccion = TestBed.inject(EleccionDelArmador);
  });

  afterEach(() => http.verify());

  it('no envía nada con datos inválidos y marca los campos', async () => {
    const fixture = crear();
    const raiz = fixture.nativeElement as HTMLElement;

    raiz.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    http.expectNone(URL);
    expect(raiz.querySelector('#pedido-nombre')!.getAttribute('aria-invalid')).toBe('true');
    expect(raiz.querySelector('#pedido-email-error')).not.toBeNull();
  });

  it('marca un campo recién después de editarlo y salir, no al pasar por él', () => {
    const fixture = crear();
    const raiz = fixture.nativeElement as HTMLElement;
    const nombre = raiz.querySelector<HTMLInputElement>('#pedido-nombre')!;

    salir(nombre);
    fixture.detectChanges();
    expect(nombre.getAttribute('aria-invalid')).toBe('false');

    escribir(fixture, '#pedido-nombre', 'A');
    escribir(fixture, '#pedido-nombre', '');
    // Mientras escribe, aunque ya haya pasado por el campo, todavía no.
    expect(nombre.getAttribute('aria-invalid')).toBe('false');
    salir(nombre);
    fixture.detectChanges();
    expect(nombre.getAttribute('aria-invalid')).toBe('true');
    expect(nombre.getAttribute('aria-describedby')).toBe('pedido-nombre-error');
    expect(raiz.querySelector('#pedido-nombre-error')!.textContent).toContain('Error:');
  });

  it('envía el cuerpo con lo elegido en el armador, la clave de intento y muestra el éxito', async () => {
    eleccion.sedes.set('hasta-tres');
    eleccion.servicios.set('ambos');
    eleccion.ia.set('si');
    const fixture = crear();
    const raiz = fixture.nativeElement as HTMLElement;

    escribir(fixture, '#pedido-nombre', ' Ana ');
    escribir(fixture, '#pedido-apellido', 'Ferreyra');
    escribir(fixture, '#pedido-email', 'ana@centro.test');
    escribir(fixture, '#pedido-nombreCentro', 'Centro Movimiento');
    aceptarTerminos(fixture);
    raiz.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    const pedido = http.expectOne(URL);
    expect(pedido.request.method).toBe('POST');
    expect(pedido.request.headers.get('Idempotency-Key')).toBeTruthy();
    expect(pedido.request.body).toEqual({
      nombre: 'Ana',
      apellido: 'Ferreyra',
      email: 'ana@centro.test',
      telefono: undefined,
      nombreCentro: 'Centro Movimiento',
      ciudad: undefined,
      kinesiologia: true,
      actividades: true,
      sedes: 'HASTA_TRES',
      interesaIa: true,
      comentario: undefined,
      sitioWeb: '',
      aceptaTerminos: true,
      versionTerminos: VERSION_TERMINOS,
    });
    expect(raiz.querySelector('button[type="submit"]')!.textContent).toContain('Enviando');

    pedido.flush(null, { status: 202, statusText: 'Accepted' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(raiz.textContent).toContain('Recibimos tu pedido');
    expect(raiz.textContent).toContain('ana@centro.test');
    expect(raiz.querySelector('form')).toBeNull();
  });

  it('sin aceptar los términos no envía y marca la casilla', async () => {
    const fixture = crear();
    const raiz = fixture.nativeElement as HTMLElement;
    escribir(fixture, '#pedido-nombre', 'Ana');
    escribir(fixture, '#pedido-apellido', 'Ferreyra');
    escribir(fixture, '#pedido-email', 'ana@centro.test');
    escribir(fixture, '#pedido-nombreCentro', 'Centro');

    raiz.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    await fixture.whenStable();

    http.expectNone(URL);
    expect(raiz.querySelector('#pedido-terminos')!.getAttribute('aria-invalid')).toBe('true');
    expect(raiz.querySelector('#pedido-terminos-error')!.textContent).toContain('pedir la prueba');
  });

  it('reusa la clave tras un corte de red y marca el campo que rechaza el backend', async () => {
    const fixture = crear();
    const raiz = fixture.nativeElement as HTMLElement;
    escribir(fixture, '#pedido-nombre', 'Ana');
    escribir(fixture, '#pedido-apellido', 'Ferreyra');
    escribir(fixture, '#pedido-email', 'ana@centro.test');
    escribir(fixture, '#pedido-nombreCentro', 'Centro');
    aceptarTerminos(fixture);

    raiz.querySelector('form')!.dispatchEvent(new Event('submit'));
    const primero = http.expectOne(URL);
    const clave = primero.request.headers.get('Idempotency-Key');
    primero.error(new ProgressEvent('error'), { status: 0, statusText: '' });
    fixture.detectChanges();
    expect(raiz.textContent).toContain('Revisá tu conexión');

    raiz.querySelector('form')!.dispatchEvent(new Event('submit'));
    const segundo = http.expectOne(URL);
    expect(segundo.request.headers.get('Idempotency-Key')).toBe(clave);
    segundo.flush(
      {
        type: 'https://akine.app/problems/validation-error',
        status: 400,
        detail: 'La solicitud contiene campos invalidos',
        errors: { email: 'El correo no es válido.' },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    await fixture.whenStable();

    expect(raiz.querySelector('#pedido-email')!.getAttribute('aria-invalid')).toBe('true');
    expect(raiz.querySelector('#pedido-email-error')!.textContent).toContain(
      'El correo no es válido.',
    );
  });

  /** Lo que hace el navegador al dejar un campo: blur en el campo y focusout que burbujea. */
  function salir(campo: HTMLElement): void {
    campo.dispatchEvent(new FocusEvent('blur'));
    campo.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  function crear() {
    const fixture = TestBed.createComponent(PedidoDePrueba);
    fixture.detectChanges();
    http.expectOne('/api/v1/terms').flush({
      aceptacionObligatoria: true,
      versionVigente: VERSION_TERMINOS,
      url: '/terminos',
    });
    fixture.detectChanges();
    return fixture;
  }

  function aceptarTerminos(fixture: { nativeElement: HTMLElement; detectChanges(): void }): void {
    fixture.nativeElement.querySelector<HTMLInputElement>('#pedido-terminos')!.click();
    fixture.detectChanges();
  }

  function escribir(
    fixture: { nativeElement: HTMLElement; detectChanges(): void },
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }
});
