import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';

import { AvisosStore } from '../../../../core/services/avisos.store';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../../core/services/flujo-de-turnos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { diaEnZona, esFecha } from '../../models/semana';
import { SchedulingApi } from '../../services/scheduling-api';

/**
 * La direccion de un turno, `/agenda/turnos/:turnoId`: hay enlaces guardados y avisos que la usan.
 *
 * <p>No es una pantalla: un turno se ve y se opera en un solo lugar, el panel del flujo unico. Esto
 * abre `/agenda` en el dia del turno, con su panel encima, y se reemplaza en el historial del
 * navegador para que "atras" no vuelva a pasar por aca.
 *
 * <p><b>El dia es el de la sede</b>, y por eso se espera a que su zona se resuelva: el guard de
 * contexto la dispara sin esperarla y, entrando por un enlace, todavia no volvio. Con la del navegador,
 * un turno de la noche abriria la agenda del dia siguiente.
 *
 * <p><b>Si el turno no se puede leer</b> —no existe, o es de otra sede— el panel se abre igual y dice
 * por que: esta lectura solo busca el dia, y el error lo cuenta quien sabe contarlo. Si el enlace traia
 * `?fecha=`, como los viejos, esa fecha sirve de respaldo.
 */
@Component({
  selector: 'app-abrir-turno-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="estado estado--cargando">Abriendo el turno…</p>`,
})
export class AbrirTurnoPage implements OnInit {
  private readonly api = inject(SchedulingApi);
  private readonly avisos = inject(AvisosStore);
  private readonly dia = inject(DiaDeLaSede);
  private readonly flujo = inject(FlujoDeTurnosStore);
  private readonly router = inject(Router);
  private readonly tenant = inject(TenantContextStore);

  /** Del path. `withComponentInputBinding` lo liga solo. */
  readonly turnoId = input.required<string>();

  /** De la query: un parametro ausente llega como `undefined`. */
  readonly fecha = input<string | undefined>();

  /** `undefined` mientras se lee. Vacio si no se pudo leer: la agenda abre sin el dia del turno. */
  private readonly inicio = signal<string | undefined>(undefined);

  constructor() {
    effect(() => {
      const inicio = this.inicio();
      if (inicio === undefined || (inicio !== '' && !this.dia.resuelta())) {
        return;
      }
      untracked(() => this.irALaAgenda(inicio));
    });
  }

  ngOnInit(): void {
    const turnoId = Number(this.turnoId());
    const consultorioId = this.tenant.consultorioId();
    if (!Number.isInteger(turnoId) || turnoId <= 0 || consultorioId === null) {
      this.avisos.error('Esa dirección no es la de un turno', {
        descripcion: 'Buscalo en la agenda.',
      });
      this.inicio.set('');
      return;
    }
    this.flujo.verTurno(turnoId);
    this.api.verTurno(consultorioId, turnoId).subscribe({
      next: (turno) => this.inicio.set(turno.inicio ?? ''),
      error: () => this.inicio.set(''),
    });
  }

  private irALaAgenda(inicio: string): void {
    const fecha = inicio === '' ? this.fecha() : diaEnZona(inicio, this.dia.zona());
    this.router
      .navigate(['/agenda'], {
        queryParams: fecha !== undefined && esFecha(fecha) ? { fecha } : {},
        replaceUrl: true,
      })
      .catch(() => undefined);
  }
}
