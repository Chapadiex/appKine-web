/**
 * Los siete dias de la semana, en la numeracion ISO-8601 que usa el contrato.
 *
 * <p><b>Lunes = 1 y domingo = 7</b>, no la numeracion de `Date#getDay()` de JavaScript, que
 * arranca en domingo = 0. Las dos convenciones se parecen lo suficiente como para que un
 * corrimiento de un dia pase inadvertido en revision y aparezca recien cuando alguien no
 * encuentra su horario del lunes: por eso los numeros se declaran una sola vez, aca, y
 * ninguna pantalla los deriva de un `Date`.
 *
 * <p>Lo usan las cuatro pantallas de horarios de AKINE-02.04 —semanal, excepciones, efectivo
 * y calendario de sede—: el rotulo de un dia no puede decir "martes" en una y "Mar" en otra.
 */
export interface DiaDeLaSemana {
  /** Numero ISO-8601: lunes = 1 .. domingo = 7. Es lo que viaja en el contrato. */
  readonly numero: number;
  readonly etiqueta: string;
}

export const DIAS_DE_LA_SEMANA: readonly DiaDeLaSemana[] = [
  { numero: 1, etiqueta: 'Lunes' },
  { numero: 2, etiqueta: 'Martes' },
  { numero: 3, etiqueta: 'Miercoles' },
  { numero: 4, etiqueta: 'Jueves' },
  { numero: 5, etiqueta: 'Viernes' },
  { numero: 6, etiqueta: 'Sabado' },
  { numero: 7, etiqueta: 'Domingo' },
];

/**
 * Nombre del dia, o un respaldo legible si el numero no es uno de los siete.
 *
 * <p>No lanza ante un numero desconocido: un backend mas nuevo podria mandar algo que este
 * cliente no conoce, y una pantalla de horarios que explota es peor que una que muestra
 * "Dia 9".
 */
export function etiquetaDeDia(numero: number | undefined): string {
  const dia = DIAS_DE_LA_SEMANA.find((candidato) => candidato.numero === numero);
  return dia?.etiqueta ?? `Dia ${numero ?? '?'}`;
}
