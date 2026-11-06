import { AbstractControl, FormControl, FormGroup, ValidationErrors } from '@angular/forms';

import { UbicacionRequestOrigenEnum } from '../../../api/generated/model/ubicacion-request';

import { DireccionPartes, tieneDireccion } from './direccion';
import { PAIS_POR_DEFECTO } from './paises';

/**
 * De donde salio el punto del mapa: lo puso el geocodificador o lo ajusto alguien a mano.
 *
 * <p>Literal y no el enum generado: el contrato genera un enum distinto para el request y
 * para la respuesta, y el formulario es el mismo para los dos. Se convierte al armar el cuerpo
 * con {@link origenParaElCable}.
 */
export type OrigenDeUbicacion = 'GEOCODIFICADA' | 'MANUAL';

/** El origen como lo declara el request del contrato. Sin origen es un ajuste a mano. */
export function origenParaElCable(origen: OrigenDeUbicacion | null): UbicacionRequestOrigenEnum {
  return origen === 'GEOCODIFICADA'
    ? UbicacionRequestOrigenEnum.GEOCODIFICADA
    : UbicacionRequestOrigenEnum.MANUAL;
}

export type UbicacionForm = FormGroup<{
  pais: FormControl<string>;
  provincia: FormControl<string>;
  ciudad: FormControl<string>;
  calle: FormControl<string>;
  numero: FormControl<string>;
  codigoPostal: FormControl<string>;
  piso: FormControl<string>;
  referencias: FormControl<string>;
  /** Texto, como todo `input`: se convierte al armar el cuerpo. */
  latitud: FormControl<string>;
  longitud: FormControl<string>;
  origen: FormControl<OrigenDeUbicacion | ''>;
}>;

/** Un punto del mapa listo para el cable. */
export interface Coordenadas {
  readonly latitud: number;
  readonly longitud: number;
}

/** Lo que el formulario sabe de la ubicacion, ya separado en direccion y punto. */
export interface UbicacionDelFormulario {
  readonly direccion: DireccionPartes;
  readonly coordenadas: Coordenadas | null;
  readonly origen: OrigenDeUbicacion | null;
}

export interface ValoresDeUbicacion extends DireccionPartes {
  readonly latitud?: number | string | null;
  readonly longitud?: number | string | null;
  readonly origen?: OrigenDeUbicacion | string | null;
}

/**
 * Formulario de direccion y ubicacion de una sede (M03, 05/11/2026).
 *
 * <p>Lo comparten el alta y la edicion. Las coordenadas se validan como par: una latitud sin
 * longitud no ubica nada, y el backend las rechaza igual. Los campos de texto no tienen
 * validadores: la direccion es opcional entera, y el largo lo limita el backend con un `400`
 * que nombra el campo.
 */
export function crearUbicacionForm(valores: ValoresDeUbicacion = {}): UbicacionForm {
  const texto = (valor: string | null | undefined, porDefecto = '') =>
    new FormControl((valor ?? porDefecto).toString(), { nonNullable: true });
  const coordenada = (valor: number | string | null | undefined, minimo: number, maximo: number) =>
    new FormControl(valor === null || valor === undefined ? '' : String(valor), {
      nonNullable: true,
      validators: [validadorNumerico(minimo, maximo)],
    });
  return new FormGroup(
    {
      pais: texto(valores.pais, PAIS_POR_DEFECTO),
      provincia: texto(valores.provincia),
      ciudad: texto(valores.ciudad),
      calle: texto(valores.calle),
      numero: texto(valores.numero),
      codigoPostal: texto(valores.codigoPostal),
      piso: texto(valores.piso),
      referencias: texto(valores.referencias),
      latitud: coordenada(valores.latitud, -90, 90),
      longitud: coordenada(valores.longitud, -180, 180),
      origen: new FormControl<OrigenDeUbicacion | ''>(
        valores.origen === 'GEOCODIFICADA' || valores.origen === 'MANUAL' ? valores.origen : '',
        { nonNullable: true },
      ),
    },
    { validators: [validadorDePar] },
  );
}

/** Reemplaza los valores sin cambiar la instancia que el template ya tiene. */
export function cargarUbicacion(formulario: UbicacionForm, valores: ValoresDeUbicacion): void {
  formulario.reset({
    pais: (valores.pais ?? PAIS_POR_DEFECTO).toString(),
    provincia: valores.provincia ?? '',
    ciudad: valores.ciudad ?? '',
    calle: valores.calle ?? '',
    numero: valores.numero ?? '',
    codigoPostal: valores.codigoPostal ?? '',
    piso: valores.piso ?? '',
    referencias: valores.referencias ?? '',
    latitud:
      valores.latitud === null || valores.latitud === undefined ? '' : String(valores.latitud),
    longitud:
      valores.longitud === null || valores.longitud === undefined ? '' : String(valores.longitud),
    origen: valores.origen === 'GEOCODIFICADA' || valores.origen === 'MANUAL' ? valores.origen : '',
  });
}

/** Un numero de un `input` de texto, o `null` si esta vacio o no es un numero. */
export function numeroDeCoordenada(valor: string): number | null {
  const texto = valor.trim().replace(',', '.');
  if (texto === '') {
    return null;
  }
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : null;
}

export function ubicacionDelFormulario(formulario: UbicacionForm): UbicacionDelFormulario {
  const valores = formulario.getRawValue();
  const latitud = numeroDeCoordenada(valores.latitud);
  const longitud = numeroDeCoordenada(valores.longitud);
  const coordenadas = latitud !== null && longitud !== null ? { latitud, longitud } : null;
  return {
    direccion: {
      pais: valores.pais.trim().toUpperCase(),
      provincia: valores.provincia.trim(),
      ciudad: valores.ciudad.trim(),
      calle: valores.calle.trim(),
      numero: valores.numero.trim(),
      codigoPostal: valores.codigoPostal.trim(),
      piso: valores.piso.trim(),
      referencias: valores.referencias.trim(),
    },
    coordenadas,
    origen: coordenadas === null ? null : valores.origen === '' ? 'MANUAL' : valores.origen,
  };
}

/** Estado que se le muestra a quien carga: que sabe el sistema de donde esta la sede. */
export type EstadoDeUbicacion = 'sin-direccion' | 'pendiente' | 'geocodificada' | 'manual';

export function estadoDeUbicacion(ubicacion: UbicacionDelFormulario): EstadoDeUbicacion {
  if (ubicacion.coordenadas !== null) {
    return ubicacion.origen === 'GEOCODIFICADA' ? 'geocodificada' : 'manual';
  }
  return tieneDireccion(ubicacion.direccion) ? 'pendiente' : 'sin-direccion';
}

function validadorNumerico(minimo: number, maximo: number) {
  return (control: AbstractControl): ValidationErrors | null => {
    const valor = typeof control.value === 'string' ? control.value : '';
    if (valor.trim() === '') {
      return null;
    }
    const numero = numeroDeCoordenada(valor);
    if (numero === null) {
      return { coordenada: true };
    }
    return numero < minimo || numero > maximo ? { rango: { minimo, maximo } } : null;
  };
}

/** Latitud y longitud van juntas: una sola no ubica nada. */
function validadorDePar(grupo: AbstractControl): ValidationErrors | null {
  const valores = grupo.value as { latitud?: string; longitud?: string };
  const hayLatitud = (valores.latitud ?? '').trim() !== '';
  const hayLongitud = (valores.longitud ?? '').trim() !== '';
  return hayLatitud === hayLongitud ? null : { par: true };
}
