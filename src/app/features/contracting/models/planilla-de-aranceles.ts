import { FilaImportacionArancelRequest } from '../../../api/generated/model/fila-importacion-arancel-request';
import { FilaImportacionArancelResponse } from '../../../api/generated/model/fila-importacion-arancel-response';

/**
 * Planilla de aranceles para la importacion masiva de un convenio (RF-M16-007, AKINE-B-7).
 *
 * <p>El backend <b>no recibe archivos</b>: recibe las filas ya en JSON. Parsear la planilla es
 * trabajo de la pantalla, y este archivo es ese parser, puro y sin Angular, para poder probarlo
 * como una tabla de casos.
 *
 * <h2>Que valida el cliente y que no</h2>
 *
 * <p>Solo el <b>formato</b>: que cada fila tenga practica, que los importes sean numeros con hasta
 * dos decimales, que las fechas existan, y el tope de {@link MAXIMO_DE_FILAS} filas. Las
 * <b>reglas</b> —que la terna cuadre, que la vigencia caiga dentro del convenio, que no se pise con
 * lo vigente— las decide la vista previa del backend fila por fila. Repetirlas aca seria una
 * segunda copia de la regla que se despega de la primera el dia que cambie, y el preview ya las
 * reporta con su `problemType`.
 */

/** Tope del contrato: el lote vacio o de mas de 500 filas se rechaza entero con 400. */
export const MAXIMO_DE_FILAS = 500;

/** Un problema de formato de la planilla. `linea` es la del texto, desde 1; `null` si es global. */
export interface ErrorDePlanilla {
  readonly linea: number | null;
  readonly mensaje: string;
}

export interface PlanillaParseada {
  /** Las filas en el orden de la planilla: la posicion N (desde 1) es la `fila` N de la respuesta. */
  readonly filas: readonly FilaImportacionArancelRequest[];
  /** Linea del texto de cada fila, para que el resultado se pueda buscar en la planilla. */
  readonly lineas: readonly number[];
  readonly errores: readonly ErrorDePlanilla[];
}

type Columna = keyof FilaImportacionArancelRequest;

/**
 * Encabezados aceptados, normalizados (minusculas, sin tildes, espacios ni guiones). Se aceptan
 * los nombres del contrato y su forma corta, que es como los escribe una persona en Excel.
 */
const ALIAS: Readonly<Record<string, Columna>> = {
  codigopractica: 'codigoPractica',
  codigo: 'codigoPractica',
  practicaid: 'practicaId',
  practica: 'practicaId',
  ofertaid: 'ofertaId',
  oferta: 'ofertaId',
  importetotal: 'importeTotal',
  total: 'importeTotal',
  importefinanciador: 'importeFinanciador',
  financiador: 'importeFinanciador',
  coseguro: 'coseguro',
  vigenciadesde: 'vigenciaDesde',
  desde: 'vigenciaDesde',
  vigenciahasta: 'vigenciaHasta',
  hasta: 'vigenciaHasta',
};

const OBLIGATORIAS: readonly Columna[] = [
  'importeTotal',
  'importeFinanciador',
  'coseguro',
  'vigenciaDesde',
];

const NOMBRE_DE_COLUMNA: Readonly<Record<Columna, string>> = {
  codigoPractica: 'codigoPractica',
  practicaId: 'practicaId',
  ofertaId: 'ofertaId',
  importeTotal: 'importeTotal',
  importeFinanciador: 'importeFinanciador',
  coseguro: 'coseguro',
  vigenciaDesde: 'vigenciaDesde',
  vigenciaHasta: 'vigenciaHasta',
};

/** Encabezado de ejemplo que la pantalla muestra y que el parser acepta tal cual. */
export const ENCABEZADO_DE_EJEMPLO =
  'codigoPractica;importeTotal;importeFinanciador;coseguro;vigenciaDesde;vigenciaHasta';

/** Planilla de ejemplo, con datos sinteticos. */
export const PLANILLA_DE_EJEMPLO = [
  ENCABEZADO_DE_EJEMPLO,
  'KIN-01;12000;9000;3000;2027-01-01;2027-12-31',
  'KIN-02;8500,50;8500,50;0;2027-01-01;',
].join('\n');

/**
 * Parsea el texto de una planilla CSV.
 *
 * <p>El separador se detecta en el encabezado: <b>`;`</b> (el que exporta Excel en castellano),
 * tabulador (lo que llega al pegar celdas copiadas de una planilla) o `,`. Con `;` o tabulador, el
 * importe admite coma decimal (`8500,50`); con `,` como separador solo punto. Sin separador de
 * miles. Las fechas van como `AAAA-MM-DD` o `DD/MM/AAAA`. Las lineas vacias y las que empiezan con
 * `#` se ignoran.
 */
export function parsearPlanilla(texto: string): PlanillaParseada {
  const renglones = texto.split(/\r?\n/).map((contenido, indice) => ({
    linea: indice + 1,
    contenido,
  }));
  const utiles = renglones.filter(
    ({ contenido }) => contenido.trim() !== '' && !contenido.trimStart().startsWith('#'),
  );

  if (utiles.length === 0) {
    return vacia([
      { linea: null, mensaje: 'La planilla esta vacia: pega o subi al menos una fila.' },
    ]);
  }

  const [cabecera, ...datos] = utiles;
  const separador = detectarSeparador(cabecera.contenido);
  const columnas = leerEncabezado(cabecera.contenido, separador, cabecera.linea);
  if ('mensaje' in columnas) {
    return vacia([columnas]);
  }

  if (datos.length === 0) {
    return vacia([
      {
        linea: null,
        mensaje: 'La planilla tiene el encabezado y ninguna fila: agrega al menos un arancel.',
      },
    ]);
  }

  if (datos.length > MAXIMO_DE_FILAS) {
    return vacia([
      {
        linea: null,
        mensaje:
          `La planilla tiene ${datos.length} filas y el maximo por importacion es ` +
          `${MAXIMO_DE_FILAS}. Partila en varias planillas y importalas de a una.`,
      },
    ]);
  }

  const filas: FilaImportacionArancelRequest[] = [];
  const lineas: number[] = [];
  const errores: ErrorDePlanilla[] = [];

  for (const { linea, contenido } of datos) {
    const celdas = partir(contenido, separador);
    if (celdas.length > columnas.length) {
      errores.push({
        linea,
        mensaje: `Tiene ${celdas.length} columnas y el encabezado declara ${columnas.length}.`,
      });
      continue;
    }
    const fila = leerFila(columnas, celdas, separador !== ',', linea, errores);
    if (fila !== null) {
      filas.push(fila);
      lineas.push(linea);
    }
  }

  return { filas, lineas, errores };
}

/**
 * El motivo de una fila rechazada, en castellano y accionable.
 *
 * <p>El `problemType` de cada fila es el mismo que daria el alta unitaria, asi que el vocabulario
 * es el de la grilla. Al motivo se le suma el `detalle` del backend, que es el que dice que campo
 * y que valor —"la terna no cuadra", "la vigencia empieza antes que el convenio"—.
 */
export function motivoDeFilaRechazada(fila: FilaImportacionArancelResponse): string {
  const detalle = fila.detalle?.trim() ?? '';
  const motivo = motivoBase(fila);
  return detalle === '' ? motivo : `${motivo} ${detalle}`;
}

function motivoBase(fila: FilaImportacionArancelResponse): string {
  switch (ultimoSegmento(fila.problemType)) {
    case 'arancel-solapado':
      if (fila.filaEnConflicto !== undefined && fila.filaEnConflicto !== null) {
        return (
          `Se pisa con la fila ${fila.filaEnConflicto} de esta misma planilla: la misma ` +
          'practica (y oferta) con periodos que se cruzan. Corregi una de las dos.'
        );
      }
      if (fila.arancelExistenteId !== undefined && fila.arancelExistenteId !== null) {
        return (
          `Se pisa con el arancel #${fila.arancelExistenteId}, que ya esta vigente en el ` +
          'convenio. La importacion no cierra vigencias: cerrale primero la del que ya esta.'
        );
      }
      return 'Se pisa con otro arancel de la misma practica y oferta.';
    case 'not-found':
      return 'La practica o la oferta no existe, o no es accesible desde esta sede.';
    case 'oferta-sin-obra-social':
      return 'Esa oferta no admite obra social, asi que no puede tener arancel de convenio.';
    case 'practica-no-habilitada-en-oferta':
      return 'Esa oferta no declara la practica: no se le puede poner precio dentro de ella.';
    case 'validation-error':
      return 'Datos invalidos.';
    default:
      return 'El servidor rechazo la fila.';
  }
}

function ultimoSegmento(tipo: string | undefined): string {
  if (tipo === undefined) {
    return '';
  }
  const partes = tipo.split('/');
  return partes[partes.length - 1] ?? '';
}

function vacia(errores: readonly ErrorDePlanilla[]): PlanillaParseada {
  return { filas: [], lineas: [], errores };
}

function detectarSeparador(cabecera: string): string {
  if (cabecera.includes(';')) {
    return ';';
  }
  if (cabecera.includes('\t')) {
    return '\t';
  }
  return ',';
}

function normalizar(encabezado: string): string {
  return encabezado
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]/g, '');
}

function leerEncabezado(
  contenido: string,
  separador: string,
  linea: number,
): readonly Columna[] | ErrorDePlanilla {
  const columnas: Columna[] = [];
  for (const celda of partir(contenido, separador)) {
    const columna = ALIAS[normalizar(celda)];
    if (columna === undefined) {
      return {
        linea,
        mensaje: `Columna desconocida en el encabezado: "${celda.trim()}". Revisa los nombres del ejemplo.`,
      };
    }
    if (columnas.includes(columna)) {
      return { linea, mensaje: `La columna ${NOMBRE_DE_COLUMNA[columna]} esta repetida.` };
    }
    columnas.push(columna);
  }

  const faltantes = OBLIGATORIAS.filter((columna) => !columnas.includes(columna));
  if (faltantes.length > 0) {
    return {
      linea,
      mensaje: `Faltan columnas obligatorias: ${faltantes.map((c) => NOMBRE_DE_COLUMNA[c]).join(', ')}.`,
    };
  }
  if (!columnas.includes('codigoPractica') && !columnas.includes('practicaId')) {
    return {
      linea,
      mensaje: 'Falta la columna de la practica: codigoPractica o practicaId (o las dos).',
    };
  }
  return columnas;
}

/** Parte un renglon respetando comillas dobles (`"a;b"` es una celda, `""` es una comilla). */
function partir(contenido: string, separador: string): string[] {
  const celdas: string[] = [];
  let actual = '';
  let entreComillas = false;

  for (let i = 0; i < contenido.length; i++) {
    const caracter = contenido[i];
    if (entreComillas) {
      if (caracter === '"' && contenido[i + 1] === '"') {
        actual += '"';
        i++;
      } else if (caracter === '"') {
        entreComillas = false;
      } else {
        actual += caracter;
      }
    } else if (caracter === '"') {
      entreComillas = true;
    } else if (caracter === separador) {
      celdas.push(actual);
      actual = '';
    } else {
      actual += caracter;
    }
  }
  celdas.push(actual);
  return celdas.map((celda) => celda.trim());
}

function leerFila(
  columnas: readonly Columna[],
  celdas: readonly string[],
  admiteComaDecimal: boolean,
  linea: number,
  errores: ErrorDePlanilla[],
): FilaImportacionArancelRequest | null {
  const fila: FilaImportacionArancelRequest = {};
  const problemas: string[] = [];

  columnas.forEach((columna, indice) => {
    const valor = celdas[indice] ?? '';
    if (valor === '') {
      return;
    }
    switch (columna) {
      case 'codigoPractica':
        fila.codigoPractica = valor;
        break;
      case 'practicaId':
      case 'ofertaId': {
        const id = entero(valor);
        if (id === null) {
          problemas.push(
            `${NOMBRE_DE_COLUMNA[columna]} tiene que ser un numero entero ("${valor}").`,
          );
        } else {
          fila[columna] = id;
        }
        break;
      }
      case 'importeTotal':
      case 'importeFinanciador':
      case 'coseguro': {
        const importe = importeValido(valor, admiteComaDecimal);
        if (typeof importe === 'string') {
          problemas.push(`${NOMBRE_DE_COLUMNA[columna]}: ${importe}`);
        } else {
          fila[columna] = importe;
        }
        break;
      }
      case 'vigenciaDesde':
      case 'vigenciaHasta': {
        const fecha = fechaIso(valor);
        if (fecha === null) {
          problemas.push(
            `${NOMBRE_DE_COLUMNA[columna]} no es una fecha valida ("${valor}"); usa AAAA-MM-DD o DD/MM/AAAA.`,
          );
        } else {
          fila[columna] = fecha;
        }
        break;
      }
    }
  });

  const practicaIdMalEscrita = problemas.some((p) => p.startsWith('practicaId'));
  if (fila.codigoPractica === undefined && fila.practicaId === undefined && !practicaIdMalEscrita) {
    problemas.push('Falta la practica: completa codigoPractica o practicaId.');
  }
  for (const columna of OBLIGATORIAS) {
    if (
      fila[columna] === undefined &&
      !problemas.some((p) => p.startsWith(NOMBRE_DE_COLUMNA[columna]))
    ) {
      problemas.push(`Falta ${NOMBRE_DE_COLUMNA[columna]}.`);
    }
  }

  if (problemas.length > 0) {
    errores.push({ linea, mensaje: problemas.join(' ') });
    return null;
  }
  return fila;
}

function entero(valor: string): number | null {
  return /^\d{1,15}$/.test(valor) ? Number(valor) : null;
}

/** El importe como numero, o el motivo por el que no lo es. */
function importeValido(valor: string, admiteComaDecimal: boolean): number | string {
  const normalizado = admiteComaDecimal ? valor.replace(',', '.') : valor;
  if (!/^\d+(\.\d+)?$/.test(normalizado)) {
    return (
      `"${valor}" no es un importe valido: solo digitos, sin signo ni separador de miles` +
      (admiteComaDecimal ? ', con coma o punto decimal.' : ', con punto decimal.')
    );
  }
  if (/\.\d{3,}$/.test(normalizado)) {
    return `"${valor}" tiene mas de dos decimales; el arancel se guarda al centavo.`;
  }
  return Number(normalizado);
}

function fechaIso(valor: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valor);
  let anio: number;
  let mes: number;
  let dia: number;
  if (iso !== null) {
    [anio, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (local !== null) {
    [dia, mes, anio] = [Number(local[1]), Number(local[2]), Number(local[3])];
  } else {
    return null;
  }
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    return null;
  }
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
