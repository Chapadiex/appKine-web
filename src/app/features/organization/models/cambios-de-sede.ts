import { ConsultorioResponse } from '../../../api/generated/model/consultorio-response';
import { UpdateConsultorioRequest } from '../../../api/generated/model/update-consultorio-request';
import { numeroDeclarado } from '../../../shared/utils/numero-declarado';
import { tieneDireccion } from './direccion';
import { UbicacionForm, origenParaElCable, ubicacionDelFormulario } from './ubicacion-form';

/** Campos de texto opcionales: los que el `PATCH` puede BORRAR con una cadena vacia. */
const CAMPOS_INSTITUCIONALES = [
  'alias',
  'legalName',
  'taxId',
  'addressLine',
  'phone',
  'contactEmail',
] as const;

/** Partes de la direccion fisica, con la misma regla de borrado que los institucionales. */
const PARTES_DE_DIRECCION = [
  'pais',
  'provincia',
  'ciudad',
  'calle',
  'numero',
  'codigoPostal',
  'piso',
  'referencias',
] as const;

/** Los datos de la sede tal como los tiene un formulario: todo texto, salvo los interruptores. */
export interface ValoresDeSede {
  readonly name: string;
  readonly alias: string;
  readonly timezone: string;
  readonly slotMinutes: string | null;
  readonly phone: string;
  readonly contactEmail: string;
  readonly agendaHabilitada: boolean;
  readonly direccionPublica: boolean;
  readonly datosFiscalesPropios: boolean;
  readonly legalName: string;
  readonly taxId: string;
  readonly addressLine: string;
}

/** Lo que un formulario de sede carga a partir de lo que devolvio el backend. */
export function valoresDeSede(sede: ConsultorioResponse): ValoresDeSede {
  return {
    name: sede.name ?? '',
    alias: sede.alias ?? '',
    timezone: sede.timezone ?? '',
    slotMinutes: sede.slotMinutes === undefined ? '' : String(sede.slotMinutes),
    phone: sede.phone ?? '',
    contactEmail: sede.contactEmail ?? '',
    agendaHabilitada: sede.agendaHabilitada ?? true,
    direccionPublica: sede.direccionPublica ?? true,
    datosFiscalesPropios: sede.datosFiscalesPropios ?? false,
    legalName: sede.legalName ?? '',
    taxId: sede.taxId ?? '',
    addressLine: sede.addressLine ?? '',
  };
}

/**
 * El cuerpo del `PATCH` de una sede, distinguiendo <b>omitido</b> de <b>cadena vacia</b>.
 *
 * <p>Un campo ausente no se toca; uno con cadena vacia se borra. La regla es la comparacion
 * contra `original`, que es lo que el backend devolvio:
 *
 * <pre>
 * valor igual al original          -&gt; se omite      (no lo toco)
 * valor distinto y no vacio        -&gt; se manda      (lo cambio)
 * valor vaciado, original con dato -&gt; se manda ''   (lo borro a proposito)
 * valor vacio, original vacio      -&gt; se omite      (nunca hubo nada)
 * </pre>
 *
 * <p>`name`, `timezone` y `slotMinutes` no son borrables: solo viajan si cambian a un valor real.
 */
export function cambiosDeSede(
  original: ConsultorioResponse & { readonly version: number },
  valores: ValoresDeSede,
  ubicacionForm: UbicacionForm,
): UpdateConsultorioRequest {
  const cambios: UpdateConsultorioRequest = { version: original.version };

  const nombre = valores.name.trim();
  if (nombre !== (original.name ?? '')) {
    cambios.name = nombre;
  }

  if (valores.timezone !== '' && valores.timezone !== (original.timezone ?? '')) {
    cambios.timezone = valores.timezone;
  }

  const slot = numeroDeclarado(valores.slotMinutes);
  if (slot !== null && slot !== original.slotMinutes) {
    cambios.slotMinutes = slot;
  }

  for (const campo of CAMPOS_INSTITUCIONALES) {
    const actual = valores[campo].trim();
    if (actual !== (original[campo] ?? '')) {
      cambios[campo] = actual;
    }
  }

  for (const campo of ['agendaHabilitada', 'direccionPublica', 'datosFiscalesPropios'] as const) {
    if (valores[campo] !== (original[campo] ?? campo !== 'datosFiscalesPropios')) {
      cambios[campo] = valores[campo];
    }
  }

  const ubicacion = ubicacionDelFormulario(ubicacionForm);
  const hayDireccion = tieneDireccion(ubicacion.direccion);
  for (const parte of PARTES_DE_DIRECCION) {
    const actual = ubicacion.direccion[parte] ?? '';
    const previo = original[parte] ?? '';
    // El pais arranca en Argentina para no pedirlo: solo, sin otra parte, no es una direccion.
    if (parte === 'pais' && !hayDireccion && previo === '') {
      continue;
    }
    if (actual !== previo) {
      cambios[parte] = actual;
    }
  }

  const previa = original.ubicacion ?? null;
  const latitudPrevia = previa?.latitud ?? null;
  const longitudPrevia = previa?.longitud ?? null;
  const punto = ubicacion.coordenadas;
  if (punto === null) {
    if (latitudPrevia !== null) {
      // Las dos en `null` es la forma que el contrato define para quitar el punto.
      cambios.ubicacion = { latitud: null, longitud: null };
    }
  } else if (
    punto.latitud !== latitudPrevia ||
    punto.longitud !== longitudPrevia ||
    (ubicacion.origen ?? 'MANUAL') !== (previa?.origen ?? 'MANUAL')
  ) {
    cambios.ubicacion = {
      latitud: punto.latitud,
      longitud: punto.longitud,
      origen: origenParaElCable(ubicacion.origen),
    };
  }

  return cambios;
}
