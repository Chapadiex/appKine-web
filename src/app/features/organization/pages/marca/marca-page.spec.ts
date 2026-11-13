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

const COLOR_DE_A = '#0f766e';
const COLOR_DE_B = '#4338ca';

const marcaDe = (organizationId: number, colorPrincipalClaro: string): MarcaResponse => ({
  organizationId,
  version: 3,
  colorPrincipalClaro,
  email: 'contacto@centro.example',
});

describe('MarcaPage', () => {
  let fixture: ComponentFixture<MarcaPage>;
  let httpMock: HttpTestingController;
  let tenant: TenantContextStore;
  const adoptada = vi.fn();

  const campoDeColor = (): HTMLInputElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '#color-claro-principal-hex',
    )!;
  const color = (): string => campoDeColor().value;

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
            temaEfectivo: signal('claro'),
            logosPorTema: signal({ claro: null, oscuro: null }),
            adoptar: adoptada,
            previsualizar: () => undefined,
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
    httpMock.expectOne('/api/v1/organizations/2/marca').flush(marcaDe(2, COLOR_DE_B));
    // La respuesta del centro anterior llega ultima: no puede pisar lo que se edita de B.
    deA.flush(marcaDe(1, COLOR_DE_A));
    await fixture.whenStable();

    expect(color()).toBe(COLOR_DE_B);
  });

  it('no adopta el guardado de un centro si ya se cambio a otro', async () => {
    httpMock.expectOne('/api/v1/organizations/1/marca').flush(marcaDe(1, COLOR_DE_A));
    await fixture.whenStable();

    const campo = campoDeColor();
    campo.value = '#be185d';
    campo.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button[type="submit"]')!
      .click();
    const guardado = httpMock.expectOne({ method: 'PUT', url: '/api/v1/organizations/1/marca' });
    expect(guardado.request.body.version).toBe(3);
    // El contacto no se edita aca, pero viaja: el servidor reemplaza la marca entera.
    expect(guardado.request.body.email).toBe('contacto@centro.example');

    tenant.select({ organizationId: 2, organizationName: 'Centro B' });
    await fixture.whenStable();
    httpMock.expectOne('/api/v1/organizations/2/marca').flush(marcaDe(2, COLOR_DE_B));
    guardado.flush(marcaDe(1, '#be185d'));
    await fixture.whenStable();

    expect(color()).toBe(COLOR_DE_B);
    // Los colores del centro anterior tampoco se pintan sobre el nuevo.
    expect(adoptada).not.toHaveBeenCalled();
  });
});
