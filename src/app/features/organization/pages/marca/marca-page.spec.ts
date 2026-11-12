import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { provideApi } from '../../../../api/generated/provide-api';
import { MarcaResponse } from '../../../../api/generated/model/marca-response';
import { MarcaStore } from '../../../../core/services/marca.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { MarcaPage } from './marca-page';

const marcaDe = (organizationId: number, email: string): MarcaResponse => ({
  organizationId,
  version: 3,
  colorPrincipalClaro: organizationId === 1 ? '#0f766e' : '#4338ca',
  email,
});

describe('MarcaPage', () => {
  let fixture: ComponentFixture<MarcaPage>;
  let httpMock: HttpTestingController;
  let tenant: TenantContextStore;
  const adoptada = vi.fn();

  const email = (): string =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#marca-email')!.value;

  beforeEach(async () => {
    adoptada.mockClear();
    await TestBed.configureTestingModule({
      imports: [MarcaPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideApi(''),
        provideRouter([]),
        { provide: PermissionsStore, useValue: { tiene: () => true } },
        {
          provide: MarcaStore,
          useValue: {
            marca: signal<MarcaResponse | null>(null),
            logosPorTema: signal({ claro: null, oscuro: null }),
            adoptar: adoptada,
          },
        },
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    tenant = TestBed.inject(TenantContextStore);
    tenant.select({ organizationId: 1, organizationName: 'Centro A' });
    fixture = TestBed.createComponent(MarcaPage);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  it('ignora la marca de otro centro que llega despues de cambiar de contexto', async () => {
    const deA = httpMock.expectOne('/api/v1/organizations/1/marca');

    tenant.select({ organizationId: 2, organizationName: 'Centro B' });
    await fixture.whenStable();
    httpMock.expectOne('/api/v1/organizations/2/marca').flush(marcaDe(2, 'b@centro.example'));
    // La respuesta del centro anterior llega ultima: no puede pisar lo que se edita de B.
    deA.flush(marcaDe(1, 'a@centro.example'));
    await fixture.whenStable();

    expect(email()).toBe('b@centro.example');
  });

  it('no adopta el guardado de un centro si ya se cambio a otro', async () => {
    httpMock.expectOne('/api/v1/organizations/1/marca').flush(marcaDe(1, 'a@centro.example'));
    await fixture.whenStable();

    const campo = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#marca-email',
    )!;
    campo.value = 'nuevo@centro.example';
    campo.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .click();
    const guardado = httpMock.expectOne({ method: 'PUT', url: '/api/v1/organizations/1/marca' });
    expect(guardado.request.body.version).toBe(3);

    tenant.select({ organizationId: 2, organizationName: 'Centro B' });
    await fixture.whenStable();
    httpMock.expectOne('/api/v1/organizations/2/marca').flush(marcaDe(2, 'b@centro.example'));
    guardado.flush(marcaDe(1, 'nuevo@centro.example'));
    await fixture.whenStable();

    expect(email()).toBe('b@centro.example');
    // Los colores del centro anterior tampoco se pintan sobre el nuevo.
    expect(adoptada).not.toHaveBeenCalled();
  });
});
