import { AdjuntoClinicoResponseCategoriaEnum } from '../../../api/generated/model/adjunto-clinico-response';
import { AntecedenteResponseTipoEnum } from '../../../api/generated/model/antecedente-response';
import { RegistrarEntradaClinicaRequestTipoEnum } from '../../../api/generated/model/registrar-entrada-clinica-request';

/**
 * Rotulos de la Historia Clinica (D-a).
 *
 * <p>Los valores salen de los enums generados, asi que un valor nuevo del contrato no compila sin
 * su rotulo: `Record<Enum, string>` exige las claves completas.
 */
export const TIPOS_DE_ENTRADA: Readonly<Record<RegistrarEntradaClinicaRequestTipoEnum, string>> = {
  EVOLUCION: 'Evolucion',
  INDICACION: 'Indicacion',
  INTERCONSULTA: 'Interconsulta',
  OBSERVACION: 'Observacion',
  OTRO: 'Otro',
};

export const CATEGORIAS_DE_ADJUNTO: Readonly<Record<AdjuntoClinicoResponseCategoriaEnum, string>> =
  {
    ESTUDIO: 'Estudio',
    INFORME: 'Informe',
    IMAGEN: 'Imagen',
    CONSENTIMIENTO_CLINICO: 'Consentimiento clinico',
    EVOLUCION_ESCANEADA: 'Evolucion escaneada',
    OTRO: 'Otro',
  };

export const TIPOS_DE_ANTECEDENTE: Readonly<Record<AntecedenteResponseTipoEnum, string>> = {
  MEDICO: 'Medico',
  QUIRURGICO: 'Quirurgico',
  ALERGIA: 'Alergia',
  MEDICACION: 'Medicacion',
  FAMILIAR: 'Familiar',
  HABITO: 'Habito',
  OTRO: 'Otro',
};

/**
 * Los origenes que el backend publica hoy (`EventoClinicoContributor`). El contrato los declara
 * `string` y no enum, porque cada modulo contribuye el suyo: un origen nuevo se muestra con el
 * titulo que trae el evento y sin detalle, en vez de romper la pantalla.
 */
type OrigenConocido = 'ENTRADA_CLINICA' | 'ADJUNTO_CLINICO' | 'ANTECEDENTE_CLINICO' | 'SESION';

const ORIGENES: Readonly<Record<OrigenConocido, string>> = {
  ENTRADA_CLINICA: 'Entrada',
  ADJUNTO_CLINICO: 'Adjunto',
  ANTECEDENTE_CLINICO: 'Antecedente',
  SESION: 'Sesion',
};

export function esOrigenConocido(origen: string | undefined): origen is OrigenConocido {
  return origen !== undefined && origen in ORIGENES;
}

export function etiquetaDeOrigen(origen: string | undefined): string {
  return esOrigenConocido(origen) ? ORIGENES[origen] : 'Otro hecho';
}

/** El rotulo de un valor de enum, o el valor crudo si el contrato trajo uno que no se conoce. */
export function rotulo<T extends string>(
  catalogo: Readonly<Record<T, string>>,
  valor: string | undefined,
): string {
  if (valor === undefined) {
    return '';
  }
  return valor in catalogo ? catalogo[valor as T] : valor;
}

/** Un solo formateador: construir un `Intl.DateTimeFormat` cuesta, y esto se llama por fila. */
const FECHA_Y_HORA = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Fecha y hora en palabras, en la zona del navegador: "3 de octubre de 2026, 14:05". */
export function fechaYHora(instante: string | undefined): string {
  if (instante === undefined || instante === '') {
    return '';
  }
  const fecha = new Date(instante);
  return Number.isNaN(fecha.getTime()) ? '' : FECHA_Y_HORA.format(fecha);
}
