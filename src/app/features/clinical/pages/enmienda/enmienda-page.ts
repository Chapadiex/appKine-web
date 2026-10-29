import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ClinicalApi } from '../../services/clinical-api';
import { ErrorAtencion, traducirErrorAtencion } from '../../models/atencion-errors';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { PERMISO_SESION_AMEND } from '../../../../core/models/permisos';
import {
  CONDUCTAS,
  ESCALA_EVA,
  EVOLUCIONES,
  LATERALIDADES,
  TOLERANCIAS,
  instanteEnPalabras,
} from '../../models/etiquetas-de-atencion';
import { LADOS_DE_MEDICION, ladoLegible, numeroDe } from '../../models/examen-y-tratamiento';
import {
  ParametroEnEdicion,
  parametrosParaEnviar,
} from '../../components/tratamientos-de-sesion/tratamientos-de-sesion';
import { CierreDeSesionAsistenciaEnum } from '../../../../api/generated/model/cierre-de-sesion';
import {
  EnmendarSesion,
  EnmendarSesionDolorLateralidadEnum,
  EnmendarSesionEvolucionEnum,
  EnmendarSesionProximaConductaEnum,
  EnmendarSesionToleranciaEnum,
} from '../../../../api/generated/model/enmendar-sesion';
import {
  MedicionEnmendada,
  MedicionEnmendadaLateralidadEnum,
} from '../../../../api/generated/model/medicion-enmendada';
import { MedicionEnVersion } from '../../../../api/generated/model/medicion-en-version';
import { ParametroDeTratamientoTipoDatoEnum } from '../../../../api/generated/model/parametro-de-tratamiento';
import { Sesion } from '../../../../api/generated/model/sesion';
import { SesionVersion } from '../../../../api/generated/model/sesion-version';
import { TratamientoEnVersion } from '../../../../api/generated/model/tratamiento-en-version';
import {
  TratamientoEnmendado,
  TratamientoEnmendadoLateralidadEnum,
} from '../../../../api/generated/model/tratamiento-enmendado';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Migas } from '../../../../shared/components/migas/migas';

/** Un tratamiento de la version vigente mientras se corrige. */
interface TratamientoEnEdicion {
  readonly tratamientoId?: number;
  readonly practicaId?: number;
  readonly practicaNombre: string;
  readonly orden?: number;
  readonly espacioId?: number;
  readonly profesionalMembershipId?: number;
  readonly tecnica: string;
  readonly zona: string;
  readonly lateralidad: string;
  readonly duracion: string;
  readonly observacion: string;
  readonly parametros: readonly ParametroEnEdicion[];
  readonly quitado: boolean;
}

/** Una medicion de la version vigente mientras se corrige. */
interface MedicionEnEdicion {
  readonly definicionId?: number;
  readonly lateralidad: string;
  readonly nombre: string;
  readonly tipo?: string;
  readonly unidad?: string;
  readonly valor: string;
  readonly valorSiNo: boolean | null;
  readonly nota: string;
  readonly quitada: boolean;
}

/**
 * Enmienda de una sesion cerrada (AKINE-06.06, C-6, RF-M14-010, RN-M14-006).
 *
 * <h2>Enmendar no es editar</h2>
 *
 * <p>RN-M14-006 no prohibe corregir una sesion cerrada: prohibe corregirla <b>en silencio</b>. Por
 * eso el motivo va primero y es obligatorio, y lo que se manda es una version nueva que deja la
 * anterior intacta.
 *
 * <h2>Se parte de la ultima version, entera</h2>
 *
 * <p>La enmienda es un <b>reemplazo completo</b>: un campo ausente queda vacio. Por eso el
 * formulario se precarga con la ultima version —que trae todo, tratamientos y mediciones
 * incluidos— y se manda entero: si arrancara vacio, guardar sin tocar nada borraria la evolucion.
 *
 * <p>La excepcion son tratamientos y mediciones: <b>ausentes no se tocan</b>. Solo viajan si se
 * cambio algo en ellos, asi una enmienda de la nota no reescribe el examen ni arriesga el 409
 * `enmienda-cambia-practicas`.
 *
 * <h2>Lo que no se puede enmendar</h2>
 *
 * <p>La asistencia, los correlativos, la oferta, el profesional y las fechas: no estan en el
 * contrato. Tampoco se agregan practicas nuevas ni se cambia cual se hizo: eligieron al cierre que
 * autorizacion se consumio. Se corrige todo lo demas de cada tratamiento.
 *
 * <p>Solo el profesional de la sesion puede enmendar, y el rechazo es 409 `sesion-ajena`: la
 * pantalla no lo adivina, lo dice el servidor.
 */
@Component({
  selector: 'app-enmienda-page',
  imports: [Migas, CabeceraDePagina, Ayuda, RouterLink],
  templateUrl: './enmienda-page.html',
  styleUrl: '../../atencion.css',
})
export class EnmiendaPage {
  private readonly api = inject(ClinicalApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly router = inject(Router);
  private readonly permisos = inject(PermissionsStore);

  readonly sesionId = input.required<string>();

  protected readonly escala = ESCALA_EVA;
  protected readonly lateralidades = LATERALIDADES;
  protected readonly evoluciones = EVOLUCIONES;
  protected readonly tolerancias = TOLERANCIAS;
  protected readonly conductas = CONDUCTAS;
  protected readonly lados = LADOS_DE_MEDICION;
  protected readonly ladoLegible = ladoLegible;
  protected readonly instanteEnPalabras = instanteEnPalabras;
  protected readonly TipoParametro = ParametroDeTratamientoTipoDatoEnum;

  protected readonly sesion = signal<Sesion | null>(null);
  protected readonly base = signal<SesionVersion | null>(null);
  protected readonly cargando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly error = signal<ErrorAtencion | null>(null);
  protected readonly aviso = signal('');

  // --- El formulario entero -------------------------------------------------------------
  protected readonly motivo = signal('');
  protected readonly dolorEva = signal<number | null>(null);
  protected readonly dolorZona = signal('');
  protected readonly dolorLateralidad = signal('');
  protected readonly evolucion = signal('');
  protected readonly objetivoSesion = signal('');
  protected readonly motivoClinico = signal('');
  protected readonly limitacionFuncional = signal('');
  protected readonly notaDeCierre = signal('');
  protected readonly respuestaTratamiento = signal('');
  protected readonly tolerancia = signal('');
  protected readonly indicaciones = signal('');
  protected readonly proximaConducta = signal('');
  protected readonly tratamientos = signal<readonly TratamientoEnEdicion[]>([]);
  protected readonly mediciones = signal<readonly MedicionEnEdicion[]>([]);
  protected readonly tratamientosTocados = signal(false);
  protected readonly medicionesTocadas = signal(false);

  protected readonly cerrada = computed(() => this.sesion()?.numeroSesion !== undefined);
  protected readonly presente = computed(
    () => this.sesion()?.cierre?.asistencia === CierreDeSesionAsistenciaEnum.PRESENTE,
  );
  protected readonly hayConflicto = computed(() => this.error()?.causa === 'version-vieja');

  /**
   * `true` cuando ya se sabe que la cuenta NO tiene `sesion:amend` en esta sede (DP-43). Con los
   * permisos sin cargar no se afirma nada: decide el backend (403).
   */
  protected readonly sinPermiso = computed(
    () => this.permisos.cargados() && !this.permisos.tiene(PERMISO_SESION_AMEND),
  );

  /** Fecha limite de la enmienda: la que trae la sesion o la del 409 `enmienda-fuera-de-ventana`. */
  protected readonly enmendableHasta = computed(
    () => this.error()?.enmendableHasta || this.sesion()?.enmendableHasta || '',
  );

  /** Paso la ventana (DP-43): por la fecha que trae la sesion o porque el servidor lo dijo. */
  protected readonly fueraDeVentana = computed(() => {
    if (this.error()?.causa === 'enmienda-fuera-de-ventana') {
      return true;
    }
    const hasta = this.sesion()?.enmendableHasta;
    return hasta !== undefined && hasta !== '' && new Date(hasta).getTime() < Date.now();
  });

  constructor() {
    effect(() => {
      this.sesionId();
      this.tenantContext.contextEpoch();
      untracked(() => this.cargar());
    });
  }

  /**
   * Lee la sesion y su ultima version, y precarga el formulario.
   *
   * <p>El motivo <b>no se pisa</b> al releer: si el profesional ya lo escribio y releyo por un
   * conflicto, lo que se rehace es el contenido, no el por que.
   */
  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesionId = numeroDe(this.sesionId());
    if (consultorioId === null || sesionId === null) {
      return;
    }
    this.cargando.set(true);
    this.error.set(null);
    forkJoin({
      sesion: this.api.ver(consultorioId, sesionId),
      versiones: this.api.versiones(consultorioId, sesionId),
    }).subscribe({
      next: ({ sesion, versiones }) => {
        this.cargando.set(false);
        this.sesion.set(sesion);
        const ultima =
          [...versiones].sort((a, b) => (b.numeroVersion ?? 0) - (a.numeroVersion ?? 0))[0] ?? null;
        this.base.set(ultima);
        if (ultima !== null) {
          this.precargar(ultima);
        }
      },
      error: (error: unknown) => {
        this.cargando.set(false);
        this.error.set(traducirErrorAtencion(error));
      },
    });
  }

  private precargar(version: SesionVersion): void {
    this.dolorEva.set(version.dolorEva ?? null);
    this.dolorZona.set(version.dolorZona ?? '');
    this.dolorLateralidad.set(version.dolorLateralidad ?? '');
    this.evolucion.set(version.evolucion ?? '');
    this.objetivoSesion.set(version.objetivoSesion ?? '');
    this.motivoClinico.set(version.motivoClinico ?? '');
    this.limitacionFuncional.set(version.limitacionFuncional ?? '');
    this.notaDeCierre.set(version.notaDeCierre ?? '');
    this.respuestaTratamiento.set(version.respuestaTratamiento ?? '');
    this.tolerancia.set(version.tolerancia ?? '');
    this.indicaciones.set(version.indicaciones ?? '');
    this.proximaConducta.set(version.proximaConducta ?? '');
    this.tratamientos.set((version.tratamientos ?? []).map(tratamientoEnEdicion));
    this.mediciones.set((version.mediciones ?? []).map(medicionEnEdicion));
    this.tratamientosTocados.set(false);
    this.medicionesTocadas.set(false);
  }

  protected elegirDolor(valor: string): void {
    const numero = numeroDe(valor);
    this.dolorEva.set(numero);
  }

  protected cambiarTratamiento(indice: number, cambio: Partial<TratamientoEnEdicion>): void {
    this.tratamientos.update((lista) =>
      lista.map((t, i) => (i === indice ? { ...t, ...cambio } : t)),
    );
    this.tratamientosTocados.set(true);
  }

  protected cambiarParametro(
    indiceTratamiento: number,
    indiceParametro: number,
    cambio: Partial<ParametroEnEdicion>,
  ): void {
    const tratamiento = this.tratamientos()[indiceTratamiento];
    this.cambiarTratamiento(indiceTratamiento, {
      parametros: tratamiento.parametros.map((p, i) =>
        i === indiceParametro ? { ...p, ...cambio } : p,
      ),
    });
  }

  protected quitarParametro(indiceTratamiento: number, indiceParametro: number): void {
    const tratamiento = this.tratamientos()[indiceTratamiento];
    this.cambiarTratamiento(indiceTratamiento, {
      parametros: tratamiento.parametros.filter((_, i) => i !== indiceParametro),
    });
  }

  protected cambiarMedicion(indice: number, cambio: Partial<MedicionEnEdicion>): void {
    this.mediciones.update((lista) =>
      lista.map((m, i) => (i === indice ? { ...m, ...cambio } : m)),
    );
    this.medicionesTocadas.set(true);
  }

  protected esNumerica(medicion: MedicionEnEdicion): boolean {
    return medicion.tipo === 'NUMERICO' || medicion.tipo === 'ESCALA';
  }

  /** Manda la enmienda. Se frena solo por lo que el contrato exige: motivo, y nota si vino. */
  protected enmendar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const sesion = this.sesion();
    if (consultorioId === null || sesion?.id === undefined) {
      return;
    }
    const motivo = this.motivo().trim();
    if (motivo === '') {
      this.aviso.set(
        'Falta el motivo. Sin el, una correccion es indistinguible de un cambio silencioso.',
      );
      return;
    }
    if (this.presente() && this.notaDeCierre().trim() === '') {
      this.aviso.set(
        'El paciente vino, así que la nota de cierre no puede quedar vacía: es lo que registra ' +
          'que se hizo.',
      );
      return;
    }

    const tratamientos = this.tratamientosTocados() ? this.tratamientosParaEnviar() : undefined;
    if (typeof tratamientos === 'string') {
      this.aviso.set(tratamientos);
      return;
    }
    const mediciones = this.medicionesTocadas() ? this.medicionesParaEnviar() : undefined;
    if (typeof mediciones === 'string') {
      this.aviso.set(mediciones);
      return;
    }

    const cuerpo: EnmendarSesion = {
      version: sesion.version ?? 0,
      motivo,
      dolorEva: this.dolorEva() ?? undefined,
      dolorZona: textoOAusente(this.dolorZona()),
      dolorLateralidad: deEnum(EnmendarSesionDolorLateralidadEnum, this.dolorLateralidad()),
      evolucion: deEnum(EnmendarSesionEvolucionEnum, this.evolucion()),
      objetivoSesion: textoOAusente(this.objetivoSesion()),
      motivoClinico: textoOAusente(this.motivoClinico()),
      limitacionFuncional: textoOAusente(this.limitacionFuncional()),
      notaDeCierre: textoOAusente(this.notaDeCierre()),
      respuestaTratamiento: textoOAusente(this.respuestaTratamiento()),
      tolerancia: deEnum(EnmendarSesionToleranciaEnum, this.tolerancia()),
      indicaciones: textoOAusente(this.indicaciones()),
      proximaConducta: deEnum(EnmendarSesionProximaConductaEnum, this.proximaConducta()),
      tratamientos,
      mediciones,
    };

    this.enviando.set(true);
    this.error.set(null);
    this.aviso.set('');
    this.api.enmendar(consultorioId, sesion.id, cuerpo).subscribe({
      next: () => {
        this.enviando.set(false);
        this.router
          .navigate(['/atencion', 'sesiones', sesion.id, 'versiones'])
          .catch(() => undefined);
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.error.set(traducirErrorAtencion(error));
      },
    });
  }

  private tratamientosParaEnviar(): TratamientoEnmendado[] | string {
    const enviables: TratamientoEnmendado[] = [];
    for (const t of this.tratamientos()) {
      if (t.quitado || t.practicaId === undefined) {
        continue;
      }
      const parametros = parametrosParaEnviar(t.parametros);
      if (typeof parametros === 'string') {
        return `${t.practicaNombre}: ${parametros}`;
      }
      const duracionTexto = t.duracion.trim();
      const duracion = duracionTexto === '' ? null : numeroDe(duracionTexto);
      if (
        duracionTexto !== '' &&
        (duracion === null || !Number.isInteger(duracion) || duracion < 1)
      ) {
        return `${t.practicaNombre}: la duración va en minutos enteros.`;
      }
      enviables.push({
        tratamientoId: t.tratamientoId,
        practicaId: t.practicaId,
        espacioId: t.espacioId,
        profesionalMembershipId: t.profesionalMembershipId,
        tecnica: textoOAusente(t.tecnica),
        zona: textoOAusente(t.zona),
        lateralidad: deEnum(TratamientoEnmendadoLateralidadEnum, t.lateralidad),
        duracionMinutos: duracion ?? undefined,
        observacion: textoOAusente(t.observacion),
        parametros,
      });
    }
    return enviables;
  }

  private medicionesParaEnviar(): MedicionEnmendada[] | string {
    const enviables: MedicionEnmendada[] = [];
    for (const m of this.mediciones()) {
      if (m.quitada || m.definicionId === undefined) {
        continue;
      }
      const base: MedicionEnmendada = {
        definicionId: m.definicionId,
        lateralidad: deEnum(MedicionEnmendadaLateralidadEnum, m.lateralidad),
        nota: textoOAusente(m.nota),
      };
      if (this.esNumerica(m)) {
        const numero = numeroDe(m.valor);
        if (numero === null) {
          return `${m.nombre}: el valor no es un número.`;
        }
        enviables.push({ ...base, valorNumerico: numero });
      } else if (m.tipo === 'BOOLEANO') {
        if (m.valorSiNo === null) {
          return `${m.nombre}: falta decir si o no.`;
        }
        enviables.push({ ...base, valorBooleano: m.valorSiNo });
      } else {
        const texto = m.valor.trim();
        if (texto === '') {
          return `${m.nombre}: falta el hallazgo.`;
        }
        enviables.push({ ...base, valorTexto: texto });
      }
    }
    return enviables;
  }
}

function tratamientoEnEdicion(t: TratamientoEnVersion): TratamientoEnEdicion {
  return {
    tratamientoId: t.tratamientoId,
    practicaId: t.practicaId,
    practicaNombre: t.practicaNombre ?? 'Practica',
    orden: t.orden,
    espacioId: t.espacioId,
    profesionalMembershipId: t.profesionalMembershipId,
    tecnica: t.tecnica ?? '',
    zona: t.zona ?? '',
    lateralidad: t.lateralidad ?? '',
    duracion: t.duracionMinutos?.toString() ?? '',
    observacion: t.observacion ?? '',
    parametros: (t.parametros ?? []).map((p) => ({
      clave: p.clave ?? '',
      tipoDato:
        deEnum(ParametroDeTratamientoTipoDatoEnum, p.tipoDato ?? '') ??
        ParametroDeTratamientoTipoDatoEnum.TEXTO,
      valor: p.valorNumerico !== undefined ? String(p.valorNumerico) : (p.valorTexto ?? ''),
      valorSiNo: p.valorBooleano ?? null,
      unidad: p.unidad ?? '',
    })),
    quitado: false,
  };
}

function medicionEnEdicion(m: MedicionEnVersion): MedicionEnEdicion {
  return {
    definicionId: m.definicionId,
    lateralidad: m.lateralidad ?? 'NO_APLICA',
    nombre: m.nombre ?? 'Medida',
    tipo: m.tipo,
    unidad: m.unidad,
    valor: m.valorNumerico !== undefined ? String(m.valorNumerico) : (m.valorTexto ?? ''),
    valorSiNo: m.valorBooleano ?? null,
    nota: m.nota ?? '',
    quitada: false,
  };
}

/** El valor como miembro del enum del contrato, o `undefined` para que no viaje. */
function deEnum<T extends string>(enumeracion: Record<string, T>, valor: string): T | undefined {
  return Object.values(enumeracion).find((opcion) => opcion === valor);
}

/** Texto recortado, o `undefined` para que la clave no viaje. */
function textoOAusente(valor: string): string | undefined {
  const limpio = valor.trim();
  return limpio === '' ? undefined : limpio;
}
