import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NewCollaboratorPage } from './new-collaborator-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

/**
 * Spec del alta de colaborador (M05, AKINE-01.03).
 *
 * <p>Dos cosas que ninguna otra prueba puede cubrir: que el alta salga a
 * `POST /api/v1/memberships` <b>sin `orgId` en la ruta ni en el cuerpo</b> -la organizacion
 * es del contexto, y mandarla le devolveria al cliente la capacidad de nombrar un tenant-, y
 * que el `404` de email desconocido se muestre claro pero sin volver comodo el barrido: ese
 * endpoint es un oraculo de existencia acotado a proposito.
 */
describe('NewCollaboratorPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewCollaboratorPage],
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

  it('el alta sale sin orgId: la organizacion es la del contexto', async () => {
    const fixture = montar();

    escribir(fixture, '#alta-email', 'kine@ejemplo.test');
    elegir(fixture, '#alta-roleCode', 'PROFESIONAL');
    escribir(fixture, '#alta-reason', 'Se suma al equipo de rehabilitacion');
    enviar(fixture);

    const peticion = httpMock.expectOne(
      (candidata: HttpRequest<unknown>) => candidata.url === '/api/v1/memberships',
    );
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body).toEqual({
      email: 'kine@ejemplo.test',
      roleCode: 'PROFESIONAL',
      reason: 'Se suma al equipo de rehabilitacion',
    });

    peticion.flush({ membershipId: 42 }, { status: 201, statusText: 'Created' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('42');
  });

  it('un 404 dice que no existe la cuenta y no ofrece con que seguir probando', async () => {
    const fixture = montar();

    escribir(fixture, '#alta-email', 'nadie@ejemplo.test');
    elegir(fixture, '#alta-roleCode', 'PROFESIONAL');
    escribir(fixture, '#alta-reason', 'Alta de administrativo');
    enviar(fixture);

    httpMock
      .expectOne((candidata: HttpRequest<unknown>) => candidata.url === '/api/v1/memberships')
      .flush(
        { type: 'https://akine.app/problems/not-found', detail: 'No existe la cuenta' },
        { status: 404, statusText: 'Not Found' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No existe una cuenta con ese email');

    // Nada que invite a barrer direcciones: ni sugerencias, ni un buscador de emails, ni
    // autocompletado sobre el campo. El limite de 10 por minuto y la auditoria de cada
    // intento fallido son una decision del backend que la interfaz no tiene que ablandar.
    expect(texto(fixture)).not.toContain('Proba');
    expect(fixture.nativeElement.querySelector('datalist')).toBeNull();
    expect(fixture.nativeElement.querySelector('#alta-email')?.getAttribute('autocomplete')).toBe(
      'off',
    );
  });

  it(
    'no tiene violaciones de axe con el formulario en blanco',
    async () => {
      const fixture = montar();

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  function montar() {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano', consultorioId: 3 });

    const fixture = TestBed.createComponent(NewCollaboratorPage);
    fixture.detectChanges();

    // El selector de sede se puebla con una peticion aparte; sin responderla `verify` falla.
    for (const peticion of httpMock.match(
      (candidata: HttpRequest<unknown>) => candidata.url === '/api/v1/organizations/1/consultorios',
    )) {
      peticion.flush({ content: [{ id: 3, name: 'Sede Centro', organizationId: 1 }] });
    }
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

function elegir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLSelectElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el select ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }) {
  fixture.nativeElement.querySelector('form')?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
