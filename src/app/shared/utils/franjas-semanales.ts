import {
  AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  ValidationErrors,
  Validators,
} from '@angular/forms';

import { esHoraDePared, minutosDeHora } from './horas-de-pared';

/**
 * Lista editable de franjas semanales —dia ISO + hora de pared desde/hasta—.
 *
 * <p>La usan el alta de sede (`organization`) y el calendario de la sede (`resource`) para el
 * horario general de A-8 (RF-M03-002/003). Vive en `shared/` porque los dos features la
 * comparten y un feature no importa de otro (AGENT.md 4.4). <b>No sabe de sedes</b>: valida
 * forma, rango y solapamiento, que son propiedades de cualquier lista de franjas semanales.
 *
 * <p>Las horas son texto y no `Date` por lo mismo que explica `horas-de-pared.ts`: `24:00` es
 * el unico fin que expresa la medianoche, y ningun control nativo lo acepta.
 */

/** Una franja tal como viaja: el shape coincide con el de los request del cliente generado. */
export interface FranjaSemanal {
  readonly diaSemana: number;
  readonly horaDesde: string;
  readonly horaHasta: string;
}

export type FranjaForm = FormGroup<{
  diaSemana: FormControl<number>;
  horaDesde: FormControl<string>;
  horaHasta: FormControl<string>;
}>;

export type FranjasForm = FormArray<FranjaForm>;

/**
 * Tope de franjas que acepta el backend (`FranjaHorarioGeneral.MAXIMO_FRANJAS`). Se replica
 * solo para no ofrecer el boton "Agregar" cuando ya no sirve: el backend lo valida igual.
 */
export const MAXIMO_FRANJAS = 28;

/** Una franja nueva. Sin valores, propone el lunes vacio: el usuario completa las horas. */
export function crearFranjaForm(valores?: Partial<FranjaSemanal>): FranjaForm {
  return new FormGroup(
    {
      diaSemana: new FormControl(valores?.diaSemana ?? 1, { nonNullable: true }),
      horaDesde: new FormControl(valores?.horaDesde ?? '', {
        nonNullable: true,
        validators: [Validators.required, validadorDeHora],
      }),
      horaHasta: new FormControl(valores?.horaHasta ?? '', {
        nonNullable: true,
        validators: [Validators.required, validadorDeHora],
      }),
    },
    { validators: [validadorDeRango] },
  );
}

/** La lista entera, con el validador de solapamiento entre franjas del mismo dia. */
export function crearFranjasForm(franjas: readonly Partial<FranjaSemanal>[] = []): FranjasForm {
  return new FormArray(
    franjas.map((franja) => crearFranjaForm(franja)),
    { validators: [validadorDeSolapamiento] },
  );
}

/** Reemplaza el contenido de la lista sin cambiar la instancia que el template ya tiene. */
export function reemplazarFranjas(
  lista: FranjasForm,
  franjas: readonly Partial<FranjaSemanal>[],
): void {
  lista.clear({ emitEvent: false });
  for (const franja of franjas) {
    lista.push(crearFranjaForm(franja), { emitEvent: false });
  }
  lista.updateValueAndValidity();
}

/**
 * Las franjas para el cable, <b>en el orden del formulario</b>.
 *
 * <p>El orden importa: el `400` de validacion del backend nombra la franja por indice
 * (`horarioGeneral[2].horaHasta`), y ese indice tiene que seguir apuntando a la fila que el
 * usuario ve. Por eso no se ordena ni se filtra nada aca.
 */
export function franjasDelFormulario(lista: FranjasForm): FranjaSemanal[] {
  return lista.getRawValue().map((franja) => ({
    diaSemana: Number(franja.diaSemana),
    horaDesde: franja.horaDesde.trim(),
    horaHasta: franja.horaHasta.trim(),
  }));
}

/**
 * Indices de las franjas que se pisan con otra del mismo dia.
 *
 * <p>Tocarse en un extremo (09:00–12:00 y 12:00–14:00) no es solaparse: el fin es exclusivo.
 * Las franjas con horas invalidas no participan, ya tienen su propio error.
 */
export function indicesSolapados(franjas: readonly FranjaSemanal[]): ReadonlySet<number> {
  const solapados = new Set<number>();
  const intervalos = franjas.map((franja) => ({
    dia: Number(franja.diaSemana),
    desde: minutosDeHora(franja.horaDesde.trim()),
    hasta: minutosDeHora(franja.horaHasta.trim()),
  }));

  for (let i = 0; i < intervalos.length; i++) {
    for (let j = i + 1; j < intervalos.length; j++) {
      const uno = intervalos[i];
      const otro = intervalos[j];
      if (
        uno.dia === otro.dia &&
        uno.desde !== null &&
        uno.hasta !== null &&
        otro.desde !== null &&
        otro.hasta !== null &&
        uno.desde < otro.hasta &&
        otro.desde < uno.hasta
      ) {
        solapados.add(i);
        solapados.add(j);
      }
    }
  }
  return solapados;
}

/**
 * Errores de franja que devolvio un `400 validation-error`, por indice de fila.
 *
 * <p>El backend serializa los campos rechazados como `errors` con la ruta del binding:
 * `horarioGeneral[1].horaHasta`. Se agrupan por fila —la primera razon de cada una— para
 * mostrarlas al lado de la franja que fallo y no en un cartel que obliga a contar filas.
 */
export function erroresDeFranjasDelServidor(
  errores: Readonly<Record<string, string>>,
  prefijo = 'horarioGeneral',
): ReadonlyMap<number, string> {
  const porFila = new Map<number, string>();
  const patron = new RegExp(`^${prefijo}\\[(\\d+)\\]`);
  for (const [campo, mensaje] of Object.entries(errores)) {
    const coincidencia = patron.exec(campo);
    if (coincidencia !== null) {
      const indice = Number(coincidencia[1]);
      if (!porFila.has(indice)) {
        porFila.set(indice, mensaje);
      }
    }
  }
  return porFila;
}

/** `Validators.pattern` no serviria: el patron admite `24:00`, que ningun regex de hora tiene. */
function validadorDeHora(control: AbstractControl): ValidationErrors | null {
  const valor = typeof control.value === 'string' ? control.value.trim() : '';
  if (valor === '') {
    return null;
  }
  return esHoraDePared(valor) ? null : { hora: true };
}

/** El fin tiene que ser posterior al inicio: una franja nunca cruza al dia siguiente. */
function validadorDeRango(grupo: AbstractControl): ValidationErrors | null {
  const valores = grupo.value as { horaDesde?: string; horaHasta?: string };
  const desde = minutosDeHora((valores.horaDesde ?? '').trim());
  const hasta = minutosDeHora((valores.horaHasta ?? '').trim());
  if (desde === null || hasta === null) {
    return null;
  }
  return hasta > desde ? null : { rango: true };
}

function validadorDeSolapamiento(lista: AbstractControl): ValidationErrors | null {
  const franjas = franjasDelFormulario(lista as FranjasForm);
  const solapados = indicesSolapados(franjas);
  return solapados.size === 0 ? null : { solapamiento: [...solapados] };
}
