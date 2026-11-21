import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';

import { MisTerminosResponse } from '../../../../api/generated/model/mis-terminos-response';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { PARAM_VOLVER_A } from '../../../../core/models/rutas';
import { SessionService } from '../../../../core/services/session.service';
import { TerminosPendientesStore } from '../../../../core/services/terminos-pendientes.store';
import { AceptarTerminosPage } from './aceptar-terminos-page';

const PENDIENTES: MisTerminosResponse = {
  versionVigente: '2026-11-20',
  url: '/terminos',
  pendiente: true,
};

describe('AceptarTerminosPage', () => {
  let cargar: () => Observable<MisTerminosResponse>;
  let aceptar: (version: string) => Observable<void>;
  let aceptadas: string[];
  let navegaciones: string[];
  let logout: Subject<void>;

  async function preparar(parametros: Record<string, string> = {}) {
    aceptadas = [];
    navegaciones = [];
    logout = new Subject<void>();
    await TestBed.configureTestingModule({
      imports: [AceptarTerminosPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(parametros) } },
        },
        {
          provide: TerminosPendientesStore,
          useValue: {
            cargar: () => cargar(),
            aceptar: (version: string) => {
              aceptadas.push(version);
              return aceptar(version);
            },
          },
        },
        { provide: SessionService, useValue: { logout: () => logout } },
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockImplementation((url) => {
      navegaciones.push(url.toString());
      return Promise.resolve(true);
    });
    const fixture = TestBed.createComponent(AceptarTerminosPage);
    fixture.detectChanges();
    return fixture;
  }

  function raiz(fixture: { nativeElement: HTMLElement }): HTMLElement {
    return fixture.nativeElement;
  }

  function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }): void {
    raiz(fixture).querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function marcar(fixture: { nativeElement: HTMLElement; detectChanges(): void }): void {
    raiz(fixture).querySelector<HTMLInputElement>('#aceptar-terminos')!.click();
    fixture.detectChanges();
  }

  beforeEach(() => {
    cargar = () => of(PENDIENTES);
    aceptar = () => of(undefined);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('muestra la versión a aceptar y el enlace al texto', async () => {
    const fixture = await preparar();

    expect(raiz(fixture).textContent).toContain('2026-11-20');
    expect(raiz(fixture).querySelector('a[href="/terminos"]')).not.toBeNull();
  });

  it('sin pendientes vuelve directo a donde iba', async () => {
    cargar = () => of({ ...PENDIENTES, pendiente: false });

    await preparar({ [PARAM_VOLVER_A]: '/pacientes' });

    expect(navegaciones).toEqual(['/pacientes']);
  });

  it('sin marcar la casilla no acepta y pide marcarla', async () => {
    const fixture = await preparar();

    enviar(fixture);

    expect(aceptadas).toEqual([]);
    expect(raiz(fixture).querySelector('#aceptar-terminos')!.getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(raiz(fixture).querySelector('#aceptar-terminos-error')).not.toBeNull();
  });

  it('aceptando vuelve a donde iba; un destino externo cae al inicio', async () => {
    const fixture = await preparar({ [PARAM_VOLVER_A]: 'https://otro.example.test' });

    marcar(fixture);
    enviar(fixture);

    expect(aceptadas).toEqual(['2026-11-20']);
    expect(navegaciones).toEqual(['/']);
  });

  it('si la versión cambió mientras leía, la relee y avisa', async () => {
    let lecturas = 0;
    cargar = () => {
      lecturas++;
      return of(lecturas === 1 ? PENDIENTES : { ...PENDIENTES, versionVigente: '2026-12-01' });
    };
    aceptar = () =>
      throwError(
        () =>
          new AkineHttpError(
            400,
            { type: 'https://akine.app/problems/validation-error', status: 400 },
            false,
          ),
      );
    const fixture = await preparar();

    marcar(fixture);
    enviar(fixture);

    expect(lecturas).toBe(2);
    expect(raiz(fixture).textContent).toContain('Los términos cambiaron mientras los leías');
    expect(raiz(fixture).textContent).toContain('2026-12-01');
  });

  it('un corte de red deja la casilla y explica que no se guardó', async () => {
    aceptar = () => throwError(() => new AkineHttpError(0, null, true));
    const fixture = await preparar();

    marcar(fixture);
    enviar(fixture);

    expect(raiz(fixture).textContent).toContain('No pudimos guardar tu aceptación');
    expect(navegaciones).toEqual([]);
  });

  it('si no puede leer los términos ofrece reintentar', async () => {
    cargar = () => throwError(() => new Error('caída'));
    const fixture = await preparar();

    expect(raiz(fixture).textContent).toContain('No pudimos leer los términos');

    cargar = () => of(PENDIENTES);
    (raiz(fixture).querySelector('.terminos-acciones button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(raiz(fixture).textContent).toContain('2026-11-20');
  });

  it('cerrar sesión lleva al ingreso', async () => {
    const fixture = await preparar();

    const botones = raiz(fixture).querySelectorAll<HTMLButtonElement>('.terminos-acciones button');
    botones[botones.length - 1].click();
    logout.complete();

    expect(navegaciones).toEqual(['/auth/ingresar']);
  });
});
