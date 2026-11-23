import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { FranjaDePrueba } from './franja-de-prueba';
import { ContratacionService } from '../../api/generated/api/contratacion.service';
import { ContratacionResponse } from '../../api/generated/model/contratacion-response';
import { SessionService } from '../../core/services/session.service';
import { TenantContextStore } from '../../core/services/tenant-context.store';

const UN_DIA = 86_400_000;
const enDias = (dias: number) => new Date(Date.now() + dias * UN_DIA).toISOString();

/**
 * La franja del shell con el store real: lo que se prueba es que cada situacion de la prueba y del
 * cobro mensual (contrato 0.191.0) muestre su aviso, y que al dia o sin control no ocupe lugar.
 */
describe('FranjaDePrueba', () => {
  async function pintar(datos: Record<string, unknown>): Promise<string> {
    const contratacion = datos as ContratacionResponse;
    TestBed.configureTestingModule({
      imports: [FranjaDePrueba],
      providers: [
        {
          provide: ContratacionService,
          useValue: { getContratacionDeOrganizacion: () => of(contratacion) },
        },
        { provide: SessionService, useValue: { estado: signal('activa') } },
      ],
    });
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 1,
    });
    const fixture = TestBed.createComponent(FranjaDePrueba);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('al día o sin control de cobro no muestra nada', async () => {
    expect(
      await pintar({ estado: 'ACTIVA', situacionDeCobro: 'AL_DIA', pagadoHasta: enDias(40) }),
    ).toBe('');
  });

  it('sin fecha de pago no avisa aunque la situación diga por vencer', async () => {
    expect(await pintar({ estado: 'ACTIVA', situacionDeCobro: 'POR_VENCER' })).toBe('');
  });

  it('por vencer dice la fecha y cuántos días faltan', async () => {
    const texto = await pintar({
      estado: 'ACTIVA',
      situacionDeCobro: 'POR_VENCER',
      pagadoHasta: enDias(4.5),
    });
    expect(texto).toContain('Tu suscripción vence el');
    expect(texto).toContain('en 5 días');
  });

  it('por vencer mañana y hoy', async () => {
    expect(
      await pintar({ estado: 'ACTIVA', situacionDeCobro: 'POR_VENCER', pagadoHasta: enDias(0.5) }),
    ).toContain('(mañana)');
    TestBed.resetTestingModule();
    expect(
      await pintar({ estado: 'ACTIVA', situacionDeCobro: 'POR_VENCER', pagadoHasta: enDias(-0.1) }),
    ).toContain('(hoy)');
  });

  it('vencida en gracia avisa que sigue operando', async () => {
    const texto = await pintar({
      estado: 'ACTIVA',
      situacionDeCobro: 'EN_GRACIA',
      pagadoHasta: enDias(-1),
    });
    expect(texto).toContain('Tu suscripción venció el');
    expect(texto).toContain('Seguís operando');
  });

  it('en sólo lectura por falta de pago dice cuándo se cierra el acceso', async () => {
    const texto = await pintar({
      estado: 'ACTIVA',
      situacionDeCobro: 'SOLO_LECTURA',
      pagadoHasta: enDias(-5),
      cierreEl: enDias(13),
      soloLectura: true,
    });
    expect(texto).toContain('el centro está en sólo lectura');
    expect(texto).toContain('El acceso se cierra el');
  });

  it('en sólo lectura sin fecha de cierre no la inventa', async () => {
    const texto = await pintar({
      estado: 'ACTIVA',
      situacionDeCobro: 'SOLO_LECTURA',
      pagadoHasta: enDias(-5),
    });
    expect(texto).toContain('sólo lectura');
    expect(texto).not.toContain('El acceso se cierra');
  });

  it('la prueba manda sobre el cobro: días que quedan, último día y vencida', async () => {
    expect(await pintar({ estado: 'PRUEBA', pruebaHasta: enDias(6.5) })).toContain(
      'te quedan 7 días',
    );
    TestBed.resetTestingModule();
    expect(await pintar({ estado: 'PRUEBA', pruebaHasta: enDias(0.5) })).toContain(
      'te queda 1 día',
    );
    TestBed.resetTestingModule();
    expect(await pintar({ estado: 'PRUEBA', pruebaHasta: enDias(-0.5) })).toContain('termina hoy');
    TestBed.resetTestingModule();
    expect(
      await pintar({ estado: 'PRUEBA', pruebaHasta: enDias(-3), soloLectura: true }),
    ).toContain('Tu prueba gratis terminó');
  });
});
