import { signal } from '@angular/core';
import { HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DiaDeLaSede } from '../../../core/services/dia-de-la-sede';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../core/testing/rutas-api';

/** Sede de los specs de `activity`. */
export const CONSULTORIO = 3;
export const ORGANIZACION = 1;
export const ZONA = 'America/Argentina/Cordoba';
/** Miercoles: la semana visible va del lunes 12 al domingo 18 de octubre. */
export const HOY = '2026-10-14';

export const URL_CLASES = `/api/v1/consultorios/${CONSULTORIO}/clases`;
export const URL_OFERTAS = `/api/v1/consultorios/${CONSULTORIO}/ofertas`;
export const URL_ESPACIOS = `/api/v1/organizations/${ORGANIZACION}/consultorios/${CONSULTORIO}/espacios`;

/**
 * `DiaDeLaSede` con la zona ya resuelta. El real la pide al listado de sedes cuando `contextGuard`
 * corre, y los specs de pagina no pasan por el guard: sin esto las horas saldrian en la zona del
 * runner.
 */
export function diaDeLaSedeFijo(): Partial<DiaDeLaSede> {
  return {
    zona: signal(ZONA),
    hoy: () => HOY,
    alinear: () => undefined,
    cargar: () => undefined,
  };
}

export function proveerDiaDeLaSede() {
  return { provide: DiaDeLaSede, useValue: diaDeLaSedeFijo() };
}

/** Elige la sede de los specs. Si ya esta elegida no la toca: reelegirla invalidaria los permisos. */
export function elegirSede(): void {
  const tenant = TestBed.inject(TenantContextStore);
  if (tenant.consultorioId() === CONSULTORIO) {
    return;
  }
  tenant.select({
    organizationId: ORGANIZACION,
    organizationName: 'Centro Belgrano',
    consultorioId: CONSULTORIO,
    consultorioName: 'Sede Centro',
  });
}

export function textoDe(fixture: ComponentFixture<unknown>): string {
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(/\s+/g, ' ');
}

export function boton(fixture: ComponentFixture<unknown>, texto: string): HTMLButtonElement {
  const encontrado = (
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        'button:not(.ayuda-contextual__boton):not(.filtros-barra__boton):not(.tabla__orden)',
      ),
    ) as HTMLButtonElement[]
  ).find((b) => (b.textContent ?? '').replace(/\s+/g, ' ').includes(texto));
  if (encontrado === undefined) {
    throw new Error(`no se encontro el botón "${texto}"`);
  }
  return encontrado as HTMLButtonElement;
}

export function clickear(fixture: ComponentFixture<unknown>, texto: string): void {
  boton(fixture, texto).click();
  fixture.detectChanges();
}

export async function asentar(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  fixture.detectChanges();
}

export function escribir(
  fixture: ComponentFixture<unknown>,
  selector: string,
  valor: string,
): void {
  const campo = (fixture.nativeElement as HTMLElement).querySelector(selector) as
    HTMLInputElement | HTMLSelectElement;
  if (campo === null) {
    throw new Error(`no se encontro ${selector}`);
  }
  campo.value = valor;
  campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? 'change' : 'input'));
  fixture.detectChanges();
}

/** Carga los permisos efectivos del contexto con los codigos dados. */
export function otorgar(httpMock: HttpTestingController, ...permisos: string[]): void {
  elegirSede();
  TestBed.inject(PermissionsStore).cargar().subscribe();
  httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: permisos });
}
