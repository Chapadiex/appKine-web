import { Observable, of, throwError } from 'rxjs';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { EstadoSesion, SessionService } from '../../../../core/services/session.service';
import { LoginPage } from './login-page';

/**
 * Doble de `SessionService`.
 *
 * El servicio real lo implementa el agente de `core/`: aca se programa contra la interfaz
 * acordada. La pantalla no debe saber nada de tokens ni de cookies.
 */
class SessionServiceFalsa {
  readonly estadoInterno = signal<EstadoSesion>('anonimo');
  readonly estado = this.estadoInterno.asReadonly();
  respuesta: Observable<void> = of(undefined);
  llamadas: { email: string; password: string }[] = [];

  login(email: string, password: string): Observable<void> {
    this.llamadas.push({ email, password });
    return this.respuesta;
  }
}

function error(
  status: number,
  type: string,
  detail: string,
  reintentarEnSegundos: number | null = null,
): AkineHttpError {
  return new AkineHttpError(status, { type, detail, status }, false, reintentarEnSegundos);
}

describe('LoginPage', () => {
  let session: SessionServiceFalsa;
  let router: Router;

  beforeEach(async () => {
    session = new SessionServiceFalsa();

    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: session as unknown as SessionService },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
  });

  it('con la sesion sin contexto lleva al selector, no al destino final', async () => {
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    session.estadoInterno.set('sin-contexto');

    const fixture = crear();
    escribir(fixture, '#login-email', 'kine@ejemplo.test');
    escribir(fixture, '#login-password', 'clave-de-prueba');
    enviar(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(session.llamadas).toEqual([{ email: 'kine@ejemplo.test', password: 'clave-de-prueba' }]);
    // Con el destino por defecto, porque este caso entra al login sin `volverA`.
    expect(navegar).toHaveBeenCalledWith('/seleccionar-contexto?volverA=%2Forganizacion');
  });

  it('sin contexto arrastra el destino pedido hasta el selector', async () => {
    // El recorrido real es guard de contexto -> selector -> guard de auth -> login. Si el
    // login navega al selector "pelado", el destino original se pierde en el ultimo tramo y
    // todo el mundo termina en la pantalla por defecto sin importar que hubiera pedido.
    TestBed.resetTestingModule();
    const sesion = new SessionServiceFalsa();
    sesion.estadoInterno.set('sin-contexto');

    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: sesion as unknown as SessionService },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap({ volverA: '/organizacion/suscripcion' }),
            },
          },
        },
      ],
    }).compileComponents();

    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    const fixture = crear();
    escribir(fixture, '#login-email', 'kine@ejemplo.test');
    escribir(fixture, '#login-password', 'clave-de-prueba');
    enviar(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navegar).toHaveBeenCalledWith(
      '/seleccionar-contexto?volverA=%2Forganizacion%2Fsuscripcion',
    );
  });

  it('con la sesion ya activa va al destino por defecto', async () => {
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    session.estadoInterno.set('activa');

    const fixture = crear();
    escribir(fixture, '#login-email', 'kine@ejemplo.test');
    escribir(fixture, '#login-password', 'clave-de-prueba');
    enviar(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navegar).toHaveBeenCalledWith('/organizacion');
  });

  it('no llama al backend con el formulario invalido y enfoca el primer campo con error', () => {
    const fixture = crear();
    enviar(fixture);
    fixture.detectChanges();

    expect(session.llamadas).toEqual([]);
    expect(document.activeElement?.id).toBe('login-email');
    expect(texto(fixture)).toContain('Escribi un email valido');
  });

  it('asocia el error al campo con aria-describedby', () => {
    const fixture = crear();
    enviar(fixture);
    fixture.detectChanges();

    const campo = fixture.nativeElement.querySelector('#login-email') as HTMLInputElement;
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toBe('login-email-error');
    expect(fixture.nativeElement.querySelector('#login-email-error')).toBeTruthy();
  });

  it('ante credenciales invalidas muestra un unico mensaje y lo anuncia como alerta', async () => {
    session.respuesta = throwError(() =>
      error(401, 'https://akine.app/problems/invalid-credentials', 'Credenciales invalidas'),
    );

    const fixture = crear();
    escribir(fixture, '#login-email', 'kine@ejemplo.test');
    escribir(fixture, '#login-password', 'lo-que-sea');
    enviar(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Email o contrasena incorrectos');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    // El mensaje no puede delatar que la cuenta existe pero esta sin activar o bloqueada.
    expect(texto(fixture)).not.toContain('activar');
    expect(texto(fixture)).not.toContain('bloquead');
  });

  it('ante un 429 con Retry-After deshabilita el boton y muestra los segundos que faltan', async () => {
    session.respuesta = throwError(() =>
      error(429, 'https://akine.app/problems/rate-limited', 'Demasiados intentos', 45),
    );

    const fixture = crear();
    escribir(fixture, '#login-email', 'kine@ejemplo.test');
    escribir(fixture, '#login-password', 'lo-que-sea');
    enviar(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    const boton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(texto(fixture)).toContain('Volve a intentar en 45 segundos');
  });

  it('ante un 429 SIN Retry-After no inventa una cuenta regresiva ni bloquea el boton', async () => {
    // Un "espera 60 segundos" que no sale del backend miente en las dos direcciones: si el
    // limite era de 10 s hace esperar de mas, y si era de 5 minutos promete que a los 60 s
    // ya se puede. La autoridad del plazo es el backend, que rechaza igual si es pronto.
    session.respuesta = throwError(() =>
      error(429, 'https://akine.app/problems/rate-limited', 'Demasiados intentos'),
    );

    const fixture = crear();
    escribir(fixture, '#login-email', 'kine@ejemplo.test');
    escribir(fixture, '#login-password', 'lo-que-sea');
    enviar(fixture);
    await fixture.whenStable();
    fixture.detectChanges();

    const boton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    expect(texto(fixture)).toContain('Demasiados intentos');
    expect(texto(fixture)).not.toContain('segundos');
  });

  it('ofrece las salidas de recuperacion y de reenvio de activacion', () => {
    const fixture = crear();

    const enlaces = [...fixture.nativeElement.querySelectorAll('a')].map((a: HTMLAnchorElement) =>
      a.getAttribute('href'),
    );
    expect(enlaces).toContain('/auth/olvide-mi-contrasena');
    expect(enlaces).toContain('/auth/reenviar-activacion');
  });

  // --- Accesibilidad ---------------------------------------------------------------

  it(
    'no tiene violaciones de axe en reposo',
    async () => {
      await esperarSinViolaciones(crear().nativeElement);
    },
    TIMEOUT_AXE,
  );

  it(
    'no tiene violaciones de axe con los campos en error',
    async () => {
      const fixture = crear();
      enviar(fixture);
      fixture.detectChanges();

      // El estado de error es el que mas atributos ARIA mueve -`aria-invalid`,
      // `aria-describedby` apuntando a un id que solo existe mientras hay error-, y es
      // justamente el que una revision a ojo no vuelve a mirar.
      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  function crear() {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    return fixture;
  }
});

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

function enviar(fixture: { nativeElement: HTMLElement }): void {
  const formulario = fixture.nativeElement.querySelector('form') as HTMLFormElement;
  formulario.dispatchEvent(new Event('submit'));
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
