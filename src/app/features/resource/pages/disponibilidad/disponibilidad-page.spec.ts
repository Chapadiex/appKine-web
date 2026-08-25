import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DisponibilidadPage } from './disponibilidad-page';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const DISPONIBILIDAD = '/api/v1/organizations/1/consultorios/3/espacios/availability';

/**
 * Espacio en servicio tal como lo devuelve el backend en 0.7.0.
 *
 * <p>`lugaresComprometidos` viene en <b>0</b> y `lugaresDisponibles` igual a `capacidad`, que
 * es lo que va a pasar siempre mientras no exista ningun modulo que reserve.
 */
const BOX_1 = {
  espacioId: 10,
  name: 'Box 1',
  tipo: 'BOX',
  capacidad: 2,
  lugaresComprometidos: 0,
  lugaresDisponibles: 2,
  disponible: true,
};

/**
 * Spec de la vista de disponibilidad (M04, RF-M04-003).
 *
 * <p>Un solo `it`, que recorre el camino real de la pantalla: ventana invalida rechazada sin
 * salir a la red, ventana valida consultada en UTC, y resultado leido sin prometer ocupacion.
 *
 * <p>Las dos cosas que cubre y que no fallan solas:
 *
 * <ol>
 *   <li>El tope de 31 dias se valida <b>antes</b> de salir. El backend lo rechaza igual, pero
 *       con un `400` cuyo texto no dice cual de los dos campos corregir.</li>
 *   <li>La tabla muestra <b>capacidad</b> y nunca lugares libres. Hoy los dos numeros
 *       coinciden, asi que un rotulo equivocado se veria correcto: el dia que exista la agenda
 *       empezaria a mentir sin que nadie tocara esta pantalla.</li>
 * </ol>
 */
describe('DisponibilidadPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DisponibilidadPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
  });

  afterEach(() => httpMock.verify());

  it('rechaza la ventana de mas de 31 dias sin salir a la red y muestra capacidad, no ocupacion', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(DisponibilidadPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Arranca en `inicial`: sin ventana elegida la peticion seria invalida, asi que consultar
    // al entrar seria un 400 garantizado en cada visita.
    expect(texto(fixture)).toContain('Elegi un periodo');
    httpMock.expectNone(() => true);

    // Ventana de dos meses: se corta aca.
    escribir(fixture, '#ventana-desde', '2026-09-01T08:00');
    escribir(fixture, '#ventana-hasta', '2026-11-01T08:00');
    enviar(fixture);

    httpMock.expectNone(() => true);
    expect(texto(fixture)).toContain('no puede pasar de 31 dias');

    // Ahora una ventana valida.
    escribir(fixture, '#ventana-hasta', '2026-09-01T10:00');
    enviar(fixture);

    const consulta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.url === DISPONIBILIDAD,
    );
    // La ventana viaja en UTC, no en la hora local que escribio el usuario: son dos cosas
    // distintas y en Argentina difieren tres horas.
    // `decodeURIComponent`: el encoder del cliente generado escapa los dos puntos del ISO.
    expect(decodeURIComponent(consulta.request.params.get('desde') ?? '')).toBe(
      new Date('2026-09-01T08:00').toISOString(),
    );
    expect(decodeURIComponent(consulta.request.params.get('hasta') ?? '')).toBe(
      new Date('2026-09-01T10:00').toISOString(),
    );

    consulta.flush([BOX_1]);
    await fixture.whenStable();
    fixture.detectChanges();

    const contenido = texto(fixture);
    expect(contenido).toContain('Box 1');
    expect(contenido).toContain('2 personas a la vez');
    // Ni "libre" ni "disponible" aplicados al box: esta consulta responde si esta EN SERVICIO.
    expect(contenido).not.toMatch(/lugares? libres?/i);
    expect(contenido).not.toMatch(/\bdisponibles?\b/i);
  });
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

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }) {
  fixture.nativeElement.querySelector('form')?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
