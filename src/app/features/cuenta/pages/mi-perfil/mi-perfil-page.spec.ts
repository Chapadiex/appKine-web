import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Subject } from 'rxjs';

import { MiPerfilPage } from './mi-perfil-page';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { SessionService } from '../../../../core/services/session.service';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERFIL = { firstName: 'Ana', lastName: 'Perez', email: 'ana@ejemplo.test' };

/**
 * Spec de Mi perfil con el sistema unico de feedback (UX-12): el resultado de un boton sin
 * formulario va al aviso global, el error de carga queda en el lugar con "Reintentar", y cerrar
 * todas las sesiones -que no se deshace- se confirma en un dialogo modal y no en linea.
 */
describe('MiPerfilPage', () => {
  let httpMock: HttpTestingController;
  let cierre: Subject<void>;

  beforeEach(async () => {
    cierre = new Subject<void>();
    await TestBed.configureTestingModule({
      imports: [MiPerfilPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
        { provide: SessionService, useValue: { cerrarTodasLasSesiones: () => cierre } },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('si no puede leer el perfil lo dice en el lugar y ofrece reintentar', async () => {
    const fixture = TestBed.createComponent(MiPerfilPage);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/me').flush(null, { status: 500, statusText: 'Error' });
    await estabilizar(fixture);

    const alerta = raiz(fixture).querySelector('app-alerta');
    expect(alerta?.textContent).toContain('No pudimos cargar tus datos');
    boton(fixture, 'Reintentar').click();
    httpMock.expectOne('/api/v1/me').flush(PERFIL);
    await estabilizar(fixture);
    expect(raiz(fixture).textContent).toContain('ana@ejemplo.test');
  });

  it('el enlace de cambio de contraseña se confirma con un aviso global', async () => {
    const fixture = await montar();

    boton(fixture, 'Cambiar contraseña').click();
    const pedido = httpMock.expectOne('/api/v1/auth/password-reset');
    expect(pedido.request.body).toEqual({ email: 'ana@ejemplo.test' });
    pedido.flush(null, { status: 202, statusText: 'Accepted' });
    await estabilizar(fixture);

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.tipo).toBe('exito');
    expect(aviso?.titulo).toBe('Te mandamos el enlace');
    expect(aviso?.descripcion).toContain('ana@ejemplo.test');
  });

  it('el limite de pedidos va al aviso de error sin ofrecer reintentar', async () => {
    const fixture = await montar();

    boton(fixture, 'Cambiar contraseña').click();
    httpMock
      .expectOne('/api/v1/auth/password-reset')
      .flush(null, { status: 429, statusText: 'Too Many Requests' });
    await estabilizar(fixture);

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.tipo).toBe('error');
    expect(aviso?.descripcion).toContain('Esperá unos minutos');
    expect(aviso?.accion).toBeNull();
  });

  it('cualquier otro fallo del enlace ofrece reintentar desde el aviso', async () => {
    const fixture = await montar();

    boton(fixture, 'Cambiar contraseña').click();
    httpMock
      .expectOne('/api/v1/auth/password-reset')
      .flush(null, { status: 500, statusText: 'Error' });
    await estabilizar(fixture);

    const avisos = TestBed.inject(AvisosStore);
    const [aviso] = avisos.avisos();
    expect(aviso?.accion?.etiqueta).toBe('Reintentar');
    avisos.ejecutar(aviso!.id);
    httpMock
      .expectOne('/api/v1/auth/password-reset')
      .flush(null, { status: 202, statusText: 'Accepted' });
  });

  it('cerrar todas las sesiones se confirma en un dialogo y su error queda arriba', async () => {
    const fixture = await montar();
    expect(raiz(fixture).querySelector('app-panel-lateral')).toBeNull();

    boton(fixture, 'Cerrar sesión en todos los dispositivos').click();
    await estabilizar(fixture);
    const panel = raiz(fixture).querySelector('app-panel-lateral') as HTMLElement;
    expect(panel.textContent).toContain('Vas a salir de AKINE en todos tus dispositivos');

    boton(fixture, 'Cerrar todas las sesiones').click();
    cierre.error(new Error('caido'));
    await estabilizar(fixture);
    const primero = panel.querySelector('.panel-lateral__cuerpo')?.firstElementChild;
    expect(primero?.tagName).toBe('APP-ALERTA');
    expect(primero?.textContent).toContain('No pudimos cerrar las sesiones');

    boton(fixture, 'Cancelar').click();
    await estabilizar(fixture);
    expect(raiz(fixture).querySelector('app-panel-lateral')).toBeNull();
  });

  it('al cerrar las sesiones vuelve al ingreso', async () => {
    const fixture = await montar();
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    boton(fixture, 'Cerrar sesión en todos los dispositivos').click();
    await estabilizar(fixture);
    boton(fixture, 'Cerrar todas las sesiones').click();
    cierre.next();
    await estabilizar(fixture);

    expect(navegar).toHaveBeenCalled();
  });

  async function montar(): Promise<ComponentFixture<MiPerfilPage>> {
    const fixture = TestBed.createComponent(MiPerfilPage);
    fixture.detectChanges();
    httpMock.expectOne('/api/v1/me').flush(PERFIL);
    await estabilizar(fixture);
    return fixture;
  }
});

async function estabilizar(fixture: ComponentFixture<MiPerfilPage>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

function raiz(fixture: ComponentFixture<MiPerfilPage>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

function boton(fixture: ComponentFixture<MiPerfilPage>, rotulo: string): HTMLButtonElement {
  const encontrado = [...raiz(fixture).querySelectorAll('button')].find(
    (candidato) => (candidato.textContent ?? '').trim() === rotulo,
  );
  if (encontrado === undefined) {
    throw new Error(`No hay un boton "${rotulo}"`);
  }
  return encontrado;
}
