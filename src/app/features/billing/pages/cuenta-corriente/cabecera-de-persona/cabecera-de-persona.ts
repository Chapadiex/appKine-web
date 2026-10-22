import { Component, ViewEncapsulation, computed, effect, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { PersonaResponse } from '../../../../../api/generated/model/persona-response';
import {
  PERMISO_HC_READ,
  PERMISO_PACIENTE_READ,
  PERMISO_PASE_READ,
} from '../../../../../core/models/permisos';
import { PermissionsStore } from '../../../../../core/services/permissions.store';
import { Pestana, Pestanas } from '../../../../../shared/components/pestanas/pestanas';

const ETIQUETAS_DE_DOCUMENTO: Record<string, string> = {
  DNI: 'DNI',
  LC: 'Libreta cívica',
  LE: 'Libreta de enrolamiento',
  CI: 'Cédula de identidad',
  PASAPORTE: 'Pasaporte',
  OTRO: 'Otro documento',
};

/**
 * Cabecera de la persona y pestanas del "hub" de la ficha (UX-01), copia de la de `person`.
 *
 * <p>Es una copia y no un import porque las features no pueden importarse entre si (ADR-0004,
 * `akine/sin-imports-entre-features`). Solo dibuja lo que la pantalla ya cargo: la
 * `PersonaResponse`, o el nombre y el documento sueltos cuando la pantalla no la tiene.
 *
 * <p><b>No muestra nada clinico.</b> La pestana "Historia clínica" es un enlace a la pantalla del
 * modulo clinico, que pide el motivo y audita; se ofrece a un paciente con `hc:read`.
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

  /** Nombre a mostrar cuando la pantalla no tiene la `PersonaResponse`. */
  readonly nombreAlternativo = input<string | null>(null);

  /** Documento a mostrar cuando la pantalla no tiene la `PersonaResponse`. */
  readonly documentoAlternativo = input<string | null>(null);

  /** Si la pantalla sabe que es paciente sin tener la ficha (la historia clinica, por ejemplo). */
  readonly esPaciente = input<boolean | null>(null);

  readonly nombreComoTitulo = input(false);

  protected readonly nombre = computed(() => {
    const persona = this.persona();
    if (persona) {
      return `${persona.apellido}, ${persona.nombre}`;
    }
    return this.nombreAlternativo() || 'Ficha de la persona';
  });

  protected readonly documento = computed(() => {
    const persona = this.persona();
    if (!persona) {
      return this.documentoAlternativo();
    }
    if (persona.tipoDocumento === undefined || persona.numeroDocumento === undefined) {
      return 'Sin documento';
    }
    const tipo = ETIQUETAS_DE_DOCUMENTO[persona.tipoDocumento] ?? persona.tipoDocumento;
    return `${tipo} ${persona.numeroDocumento}`;
  });

  protected readonly inactiva = computed(() => this.persona()?.estado === 'INACTIVO');

  /** Sin `paciente:read` las pantallas del padron responden "sin permiso": no se ofrecen. */
  protected readonly puedeVerPadron = computed(() => {
    this.permisos.permisos();
    return this.permisos.tiene(PERMISO_PACIENTE_READ);
  });

  protected readonly rutaFicha = computed(() => `/pacientes/${this.personaId()}`);

  protected readonly pestanas = computed<readonly Pestana[]>(() => {
    const base = this.rutaFicha();
    const paciente = this.esPaciente() ?? this.persona()?.esPaciente === true;
    this.permisos.permisos();
    const padron = this.puedeVerPadron();
    const lista: Pestana[] = padron ? [{ etiqueta: 'Ficha', ruta: base, exacta: true }] : [];
    if (paciente && this.permisos.tiene(PERMISO_HC_READ)) {
      lista.push({
        etiqueta: 'Historia clínica',
        ruta: `/historia-clinica/personas/${this.personaId()}`,
      });
    }
    if (padron) {
      lista.push(
        { etiqueta: 'Documentos', ruta: `${base}/documentos` },
        { etiqueta: 'Coberturas', ruta: `${base}/coberturas` },
        { etiqueta: 'Órdenes y autorizaciones', ruta: `${base}/autorizaciones` },
      );
    }
    // La pantalla actual se ofrece siempre: es donde esta el usuario.
    lista.push({ etiqueta: 'Cuenta corriente', ruta: `${base}/cuenta-corriente` });
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
