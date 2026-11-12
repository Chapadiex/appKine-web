import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AltaDeEspacio } from './alta-de-espacio';
import { AvisosStore } from '../../../../core/services/avisos.store';
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
describe('AltaDeEspacio', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AltaDeEspacio],
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

    const fixture = TestBed.createComponent(AltaDeEspacio);
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
    const alerta = fixture.nativeElement.querySelector('#espacio-name-conflicto');
    expect(alerta?.textContent).toContain('SI se puede reusar');
    // Una sola alerta: el conflicto no se repite como error general.
    expect(fixture.nativeElement.querySelectorAll('app-alerta').length).toBe(1);
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

    const fixture = TestBed.createComponent(AltaDeEspacio);
    let listo = 0;
    fixture.componentInstance.listo.subscribe(() => listo++);
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

    // El resultado va al aviso global y el panel avisa que terminó, para que el listado se relea.
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Espacio dado de alta');
    expect(aviso?.descripcion).toContain('Box 9');
    expect(listo).toBe(1);
  });
  /** Sede elegida y componente montado; `listo` cuenta cuántas veces avisó que terminó. */
  async function montar(sinNombreDeSede = false) {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
      consultorioName: sinNombreDeSede ? undefined : 'Sede Centro',
    });
    const fixture = TestBed.createComponent(AltaDeEspacio);
    const avisos = { listo: 0 };
    fixture.componentInstance.listo.subscribe(() => avisos.listo++);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, avisos };
  }

  function esAlta() {
    return (peticion: HttpRequest<unknown>) =>
      peticion.method === 'POST' && peticion.url === ESPACIOS;
  }

  it('sin sede elegida no ofrece el formulario: manda a elegir consultorio', async () => {
    tenantContext.select({ organizationId: 1, organizationName: 'Belgrano' });
    const fixture = TestBed.createComponent(AltaDeEspacio);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Falta elegir un consultorio');
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/seleccionar-contexto"]')).not.toBeNull();
  });

  it('una capacidad menor a 1 no sale a la red: lo dice en el campo y lo enfoca', async () => {
    const { fixture } = await montar();
    escribir(fixture, '#espacio-name', 'Box 5');
    escribir(fixture, '#espacio-capacidad', '0');
    enviar(fixture);

    httpMock.expectNone(esAlta());
    expect(texto(fixture)).toContain('La capacidad tiene que ser al menos 1.');
    const capacidad = fixture.nativeElement.querySelector('#espacio-capacidad');
    expect(capacidad?.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(capacidad);
  });

  it('manda los opcionales cargados y, con inicio, aclara que puede figurar sin servicio', async () => {
    // Sin nombre de sede en el contexto, el aviso dice "la sede activa".
    const { fixture, avisos } = await montar(true);
    escribir(fixture, '#espacio-name', 'Gimnasio');
    const tipo = fixture.nativeElement.querySelector('#espacio-tipo') as HTMLSelectElement;
    tipo.value = 'GIMNASIO';
    tipo.dispatchEvent(new Event('change'));
    escribir(fixture, '#espacio-capacidad', '8');
    escribir(fixture, '#espacio-notes', '  Con espejos  ');
    escribir(fixture, '#espacio-validFrom', '2099-09-01T08:00');
    escribir(fixture, '#espacio-validUntil', '2099-12-01T08:00');
    enviar(fixture);

    const alta = httpMock.expectOne(esAlta());
    const cuerpo = alta.request.body as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      name: 'Gimnasio',
      tipo: 'GIMNASIO',
      capacidad: 8,
      notes: 'Con espejos',
    });
    expect(typeof cuerpo['validFrom']).toBe('string');
    expect(typeof cuerpo['validUntil']).toBe('string');
    expect(Date.parse(cuerpo['validUntil'] as string)).toBeGreaterThan(
      Date.parse(cuerpo['validFrom'] as string),
    );

    // Doble envío mientras viaja el primero: no sale un segundo POST.
    enviar(fixture);
    httpMock.expectNone(esAlta());

    // La respuesta sin nombre: el aviso usa el que se mandó.
    alta.flush({ id: 9 });
    await fixture.whenStable();
    fixture.detectChanges();
    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.descripcion).toContain('Gimnasio · la sede activa');
    expect(aviso?.descripcion).toContain('Si su inicio es futuro');
    expect(avisos.listo).toBe(1);
  });

  it('un corte de red no invita a reenviar: ofrece revisar el listado', async () => {
    const { fixture, avisos } = await montar();
    escribir(fixture, '#espacio-name', 'Box 6');
    enviar(fixture);
    httpMock.expectOne(esAlta()).error(new ProgressEvent('error'));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No pudimos dar de alta el espacio');
    expect(texto(fixture)).toContain('revisa el listado');
    const revisar = [...fixture.nativeElement.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('Revisar el listado'),
    ) as HTMLButtonElement | undefined;
    revisar?.click();
    expect(avisos.listo).toBe(1);
  });

  it('un 429 deshabilita el alta mientras corre la espera, y lo dice', async () => {
    const { fixture } = await montar();
    escribir(fixture, '#espacio-name', 'Box 7');
    enviar(fixture);
    httpMock
      .expectOne(esAlta())
      .flush(
        { type: 'https://akine.app/problems/rate-limited' },
        { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '30' } },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Podés volver a intentar en 30 segundos');
    expect(texto(fixture)).not.toContain('Revisar el listado');
    const boton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    enviar(fixture);
    httpMock.expectNone(esAlta());
    fixture.destroy();
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
