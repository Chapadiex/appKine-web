import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NewEspacioPage } from './new-espacio-page';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const ESPACIOS = '/api/v1/organizations/1/consultorios/3/espacios';

/**
 * Spec del alta de un espacio (M04, RF-M04-001).
 *
 * <p>Un solo `it`, que recorre el camino real: submit vacio rechazado, alta con los defaults, y
 * el conflicto de nombre aterrizando en el campo.
 *
 * <p>Lo que cubre y no falla solo: que los opcionales vacios se <b>omitan</b> en vez de viajar
 * como cadena vacia. En un alta `''` no significa "sin dato" sino un dato vacio, y en
 * `validFrom` seria directamente un instante invalido: el backend responde `400` sobre un
 * formulario que el usuario dejo correctamente en blanco.
 */
describe('NewEspacioPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewEspacioPage],
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

  it('omite los opcionales vacios y muestra el conflicto de nombre en el propio campo', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(NewEspacioPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Sin nombre no sale a la red: el backend lo exige y gastar un rechazo no aporta nada.
    enviar(fixture);
    httpMock.expectNone(() => true);
    expect(texto(fixture)).toContain('El espacio necesita un nombre');

    escribir(fixture, '#espacio-name', '  Box 4  ');
    enviar(fixture);

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === ESPACIOS,
    );

    // Nombre recortado, defaults explicitos y NADA de los opcionales que quedaron en blanco.
    expect(alta.request.body).toEqual({ name: 'Box 4', tipo: 'BOX', capacidad: 1 });

    // Esta operacion NO lleva Idempotency-Key, a diferencia del alta de una sede: el contrato
    // se apoya en el unique de nombre entre los espacios vigentes.
    expect(alta.request.headers.has('Idempotency-Key')).toBe(false);

    alta.flush(
      {
        type: 'https://akine.app/problems/espacio-name-taken',
        detail: 'Ya existe un espacio con ese nombre',
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    // El conflicto de nombre unico es un error DE UN CAMPO: va en el campo, con
    // `aria-describedby` apuntando al mensaje, no en un cartel al pie que obliga a adivinar.
    const campo = fixture.nativeElement.querySelector('#espacio-name');
    expect(campo?.getAttribute('aria-invalid')).toBe('true');
    expect(campo?.getAttribute('aria-describedby')).toBe('espacio-name-conflicto');
    expect(texto(fixture)).toContain('SI se puede reusar');
  });

  /**
   * Un `<input type="number">` vaciado entrega `null`, no `''`.
   *
   * <p>La guarda vieja —`valores.capacidad !== ''`— lo dejaba pasar porque `null !== ''`, y
   * `Number(null)` es `0`: el alta viajaba con `capacidad: 0`, que es un espacio donde no entra
   * nadie. `Validators.min(1)` no lo frena, porque devuelve `null` —valido— ante un campo vacio,
   * y el `min="1"` del HTML tampoco, porque el formulario lleva `novalidate`.
   */
  it('vaciar la capacidad la OMITE en vez de mandar un cero', async () => {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    const fixture = TestBed.createComponent(NewEspacioPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    escribir(fixture, '#espacio-name', 'Box 9');
    escribir(fixture, '#espacio-capacidad', '');
    enviar(fixture);

    const alta = httpMock.expectOne(
      (peticion: HttpRequest<unknown>) => peticion.method === 'POST' && peticion.url === ESPACIOS,
    );
    expect(alta.request.body).toEqual({ name: 'Box 9', tipo: 'BOX' });

    alta.flush({ id: 9, name: 'Box 9' });
    await fixture.whenStable();
    fixture.detectChanges();
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
