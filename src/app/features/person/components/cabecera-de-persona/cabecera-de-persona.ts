import { Component, ViewEncapsulation, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import {
  PERMISO_COBRO_REGISTER,
  PERMISO_HC_READ,
  PERMISO_PASE_READ,
} from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { Pestana, Pestanas } from '../../../../shared/components/pestanas/pestanas';
import {
  documentoEnUnaLinea,
  nombreCompleto,
  personaInactiva,
} from '../../models/etiquetas-de-person';

/**
 * Cabecera de la persona y pestanas del "hub" de la ficha (UX-01).
 *
 * <p>La ficha es el centro: Documentos, Coberturas, Ordenes y autorizaciones, Cuenta corriente,
 * Pases y la Historia clinica se leen como pestanas de ella, con la persona arriba. Solo usa los
 * datos que la pantalla ya cargo -la `PersonaResponse`-: no pide nada propio.
 *
 * <p><b>No muestra nada clinico.</b> La pestana "Historia clínica" es un enlace a la pantalla del
 * modulo clinico, que es la que pide el motivo y audita. Se ofrece solo a un paciente y a quien
 * tiene `hc:read`; las de cuenta corriente y pases, con el mismo permiso que ya pedia la ficha.
 * Los permisos son UX: el backend decide igual.
 *
 * <p>`ViewEncapsulation.None` para poder ajustar las pestanas compartidas dentro de la banda; las
 * clases llevan el prefijo `cabecera-persona` y no chocan con nada.
 */
@Component({
  selector: 'app-cabecera-de-persona',
  imports: [RouterLink, Pestanas],
  templateUrl: './cabecera-de-persona.html',
  styleUrl: './cabecera-de-persona.css',
  encapsulation: ViewEncapsulation.None,
})
export class CabeceraDePersona {
  private readonly permisos = inject(PermissionsStore);

  readonly personaId = input.required<string>();

  readonly persona = input<PersonaResponse | null>(null);

  /** En la ficha el nombre ES el titulo de la pantalla; en las hermanas, un enlace a la ficha. */
  readonly nombreComoTitulo = input(false);

  protected readonly nombre = computed(() => {
    const persona = this.persona();
    return persona ? nombreCompleto(persona) : 'Ficha de la persona';
  });

  protected readonly documento = computed(() => {
    const persona = this.persona();
    return persona ? documentoEnUnaLinea(persona) : null;
  });

  protected readonly inactiva = computed(() => {
    const persona = this.persona();
    return persona ? personaInactiva(persona) : false;
  });

  protected readonly rutaFicha = computed(() => `/pacientes/${this.personaId()}`);

  protected readonly pestanas = computed<readonly Pestana[]>(() => {
    const base = this.rutaFicha();
    const persona = this.persona();
    // Los permisos se leen del signal: la lista se rehace cuando terminan de cargar.
    this.permisos.permisos();
    const lista: Pestana[] = [{ etiqueta: 'Ficha', ruta: base, exacta: true }];
    if (persona?.esPaciente === true && this.permisos.tiene(PERMISO_HC_READ)) {
      lista.push({
        etiqueta: 'Historia clínica',
        ruta: `/historia-clinica/personas/${this.personaId()}`,
      });
    }
    lista.push(
      { etiqueta: 'Documentos', ruta: `${base}/documentos` },
      { etiqueta: 'Coberturas', ruta: `${base}/coberturas` },
      { etiqueta: 'Órdenes y autorizaciones', ruta: `${base}/autorizaciones` },
    );
    if (this.permisos.tiene(PERMISO_COBRO_REGISTER)) {
      lista.push({ etiqueta: 'Cuenta corriente', ruta: `${base}/cuenta-corriente` });
    }
    if (this.permisos.tiene(PERMISO_PASE_READ)) {
      lista.push({ etiqueta: 'Pases', ruta: `${base}/pases` });
    }
    return lista;
  });

  constructor() {
    effect(() => {
      if (!this.permisos.cargados()) {
        this.permisos.asegurarCargados();
      }
    });
  }
}
