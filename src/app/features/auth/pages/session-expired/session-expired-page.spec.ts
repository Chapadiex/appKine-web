import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';

import { PARAM_VOLVER_A } from '../../../../core/models/rutas';
import { SessionExpiredPage } from './session-expired-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';

async function preparar(parametros: Record<string, string>): Promise<void> {
  await TestBed.configureTestingModule({
    imports: [SessionExpiredPage],
    providers: [
      provideRouter([]),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(parametros) } },
      },
    ],
  }).compileComponents();
}

describe('SessionExpiredPage', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('explica que paso y anuncia el cierre como alerta', async () => {
    await preparar({});
    const fixture = crear();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    expect(texto(fixture)).toContain('No pudimos renovar tu sesion');
  });

  it('conserva el destino interno para retomar donde se corto', async () => {
    await preparar({ [PARAM_VOLVER_A]: '/organizacion/suscripcion' });
    const fixture = crear();

    expect(enlace(fixture).getAttribute('href')).toBe(
      '/auth/ingresar?volverA=%2Forganizacion%2Fsuscripcion',
    );
  });

  it('descarta un destino externo: seria una redireccion abierta hacia phishing', async () => {
    await preparar({ [PARAM_VOLVER_A]: 'https://sitio-malicioso.test/robar' });
    const fixture = crear();

    expect(enlace(fixture).getAttribute('href')).toBe('/auth/ingresar');
  });

  it('descarta un destino protocol-relative, que tambien sale del sitio', async () => {
    await preparar({ [PARAM_VOLVER_A]: '//sitio-malicioso.test/robar' });
    const fixture = crear();

    expect(enlace(fixture).getAttribute('href')).toBe('/auth/ingresar');
  });

  it(
    'no tiene violaciones de axe',
    async () => {
      await preparar({ [PARAM_VOLVER_A]: '/organizacion' });
      await esperarSinViolaciones(crear().nativeElement);
    },
    TIMEOUT_AXE,
  );

  function crear() {
    const fixture = TestBed.createComponent(SessionExpiredPage);
    fixture.detectChanges();
    return fixture;
  }
});

function enlace(fixture: { nativeElement: HTMLElement }): HTMLAnchorElement {
  return fixture.nativeElement.querySelector('a.boton') as HTMLAnchorElement;
}

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}
