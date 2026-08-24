import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuditPage } from './audit-page';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const VACIA = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 };

/**
 * Spec de la consulta de auditoria (M24, AKINE-01.03).
 *
 * <p>Lo unico que esta pantalla tiene de particular es que el backend exige <b>exactamente
 * uno</b> de tres filtros. Se prueba que la interfaz lo haga imposible por construccion —que
 * cambiar de filtro no arrastre los campos del anterior— y que la ventana de mas de 90 dias
 * ni siquiera salga a la red. Los estados de carga y error son los mismos de las otras
 * pantallas y ya estan cubiertos alla.
 */
describe('AuditPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditPage],
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

  it('manda solo el filtro elegido, sin arrastrar los campos del anterior', async () => {
    const fixture = montar();

    // Se llena el filtro de entidad y despues se cambia de idea: los campos del primero
    // siguen en el formulario pero no pueden viajar, porque combinarlos es un 400.
    escribir(fixture, '#auditoria-entityType', 'MEMBERSHIP');
    escribir(fixture, '#auditoria-entityId', '10');
    marcar(fixture, '#auditoria-filtro-actor');
    escribir(fixture, '#auditoria-actorAccountId', '18');
    buscar(fixture);

    const peticion = httpMock.expectOne(esConsulta());
    const parametros = peticion.request.params;

    expect(parametros.get('actorAccountId')).toBe('18');
    expect(parametros.has('entityType')).toBe(false);
    expect(parametros.has('entityId')).toBe(false);
    expect(parametros.has('from')).toBe(false);

    peticion.flush(VACIA);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No hay hechos registrados');
  });

  it('una ventana de mas de 90 dias no sale a la red', () => {
    const fixture = montar();

    marcar(fixture, '#auditoria-filtro-ventana');
    escribir(fixture, '#auditoria-desde', '2026-01-01');
    escribir(fixture, '#auditoria-hasta', '2026-06-30');
    buscar(fixture);

    // El backend la rechazaria igual: el punto es que el usuario vea el limite en el campo
    // que lo causa y no gaste un rechazo del servidor para enterarse.
    httpMock.expectNone(esConsulta());
    expect(texto(fixture)).toContain('no puede superar los 90 dias');
  });

  it(
    'no tiene violaciones de axe con el filtro de ventana temporal abierto',
    async () => {
      const fixture = montar();
      marcar(fixture, '#auditoria-filtro-ventana');

      await esperarSinViolaciones(fixture.nativeElement);
    },
    TIMEOUT_AXE,
  );

  function montar() {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano', consultorioId: 3 });

    const fixture = TestBed.createComponent(AuditPage);
    fixture.detectChanges();

    // Arranca sin consultar nada: sin ninguno de los tres filtros la peticion es invalida.
    httpMock.expectNone(() => true);

    return fixture;
  }
});

function esConsulta() {
  return (peticion: HttpRequest<unknown>) =>
    peticion.url === '/api/v1/organizations/1/audit-events';
}

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

function marcar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const radio = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (radio === null) {
    throw new Error(`No existe el radio ${selector}`);
  }
  radio.click();
  fixture.detectChanges();
}

function buscar(fixture: { nativeElement: HTMLElement; detectChanges(): void }) {
  fixture.nativeElement.querySelector('form')?.dispatchEvent(new Event('submit'));
  fixture.detectChanges();
}
