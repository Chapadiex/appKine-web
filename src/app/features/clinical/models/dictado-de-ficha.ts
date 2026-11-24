import { AntecedenteResponseTipoEnum } from '../../../api/generated/model/antecedente-response';
import { FichaDeIngresoRequestActividadEnum } from '../../../api/generated/model/ficha-de-ingreso-request';
import { ZONAS_DEL_CUERPO } from './zonas-del-cuerpo';

/** Un antecedente reconocido en el dictado. */
export interface AntecedenteDictado {
  readonly tipo: AntecedenteResponseTipoEnum;
  readonly descripcion: string;
  readonly anio?: number;
  readonly zona?: string;
}

/** Lo que se entendió de un dictado de los datos declarados. Solo trae lo que se reconoció. */
export interface FichaDictada {
  readonly ocupacion?: string;
  readonly pesoKg?: number;
  readonly alturaCm?: number;
  readonly actividad?: FichaDeIngresoRequestActividadEnum;
  readonly detalle?: string;
  /** Códigos de `ENFERMEDADES_DE_INGRESO` que el paciente dijo tener. */
  readonly condiciones: readonly string[];
  readonly antecedentes: readonly AntecedenteDictado[];
}

/**
 * Palabras con las que se nombra cada condición de la ficha, ya sin tildes y en minúscula. Son
 * raíces: "diabet" cubre diabetes y diabético.
 */
const SINONIMOS_DE_CONDICION: Readonly<Record<string, readonly string[]>> = {
  DIABETES: ['diabet'],
  HIPERTENSION: ['hipertens', 'presion alta'],
  CARDIOPATIA: ['cardiopat', 'cardiac', 'problemas del corazon', 'problema del corazon'],
  MARCAPASOS: ['marcapaso'],
  OSTEOPOROSIS: ['osteoporo'],
  ANTICOAGULADO: ['anticoagul', 'sintrom'],
  EMBARAZO: ['embaraz'],
  CANCER: ['cancer', 'oncolog', 'tumor'],
  EPILEPSIA: ['epilep', 'convulsion'],
  RESPIRATORIA: ['asma', 'epoc', 'enfisema'],
};

/** Nivel de actividad por palabras; el primero que aparece manda. */
const NIVELES_DE_ACTIVIDAD: readonly (readonly [FichaDeIngresoRequestActividadEnum, RegExp])[] = [
  [
    FichaDeIngresoRequestActividadEnum.SEDENTARIO,
    /\bsedentari|\bnada de actividad|\bno hace actividad/,
  ],
  [FichaDeIngresoRequestActividadEnum.DEPORTISTA, /\bdeportista|\bentrena\b|\bcompite\b|\bcompeti/],
  [FichaDeIngresoRequestActividadEnum.OCASIONAL, /\bocasional|\besporadic|\bde vez en cuando/],
  [FichaDeIngresoRequestActividadEnum.REGULAR, /\bregular\b|\bregularmente|\bfrecuente/],
];

/** Tipo de antecedente por palabras de la frase; sin ninguna, el último que se nombró o Médico. */
const TIPOS_POR_PALABRA: readonly (readonly [AntecedenteResponseTipoEnum, RegExp])[] = [
  [
    AntecedenteResponseTipoEnum.QUIRURGICO,
    /quirurgic|\bopero\b|\boperad|\boperaci|cirugi|\bintervenid/,
  ],
  [AntecedenteResponseTipoEnum.ALERGIA, /alergi|alergic/],
  [AntecedenteResponseTipoEnum.MEDICACION, /medicaci|medicament|\btoma\b|\btomando\b/],
  [
    AntecedenteResponseTipoEnum.FAMILIAR,
    /familiar|\bpadre\b|\bmadre\b|\bhermano|\bhermana|\babuel/,
  ],
  [AntecedenteResponseTipoEnum.HABITO, /\bfuma|tabaco|cigarr|alcohol|\bbebe\b/],
  [AntecedenteResponseTipoEnum.MEDICO, /\bmedic[oa]s?\b/],
];

/** Palabras de relleno al principio de un rótulo: "algo quirúrgico", "los médicos". */
const RELLENO_DE_ROTULO = /^(?:(?:algo|los|las|de|en|antecedentes?)\s+)+/;

/** Palabras que dicen qué actividad hace, para encontrarla aunque no se diga "actividad física". */
const HACE_ACTIVIDAD =
  /\b(realiza|hace|practica|juega|camina|caminatas?|corre|entrena|gimnasio|futbol|natacion|nada en|bicicleta|yoga|pilates)\b/;

/** Conectores sueltos al principio de una frase dictada. */
const CONECTOR_INICIAL = /^(?:pero|y|que|tambien|ademas|entonces|bueno)\s+/i;

/** Dónde empieza cada parte del dictado. El texto de una parte llega hasta la siguiente. */
const MARCAS: readonly (readonly [Parte, RegExp])[] = [
  ['ocupacion', /\bocupacion\b|\btrabaja de\b|\btrabaja como\b/],
  ['peso', /\bpeso\b|\bpesa\b/],
  ['altura', /\baltura\b|\bestatura\b|\bmide\b/],
  ['actividad', /\bactividad fisica\b|\bactividad\b/],
  ['condiciones', /\btiene\b|\bcondiciones\b|\benfermedades\b|\bpatologias\b/],
  ['antecedentes', /\bantecedentes?\b/],
];

type Parte = 'ocupacion' | 'peso' | 'altura' | 'actividad' | 'condiciones' | 'antecedentes';

const NEGACION = /\b(no|sin|niega|nunca|ningun|ninguna|nada)\b/;

/**
 * Reparte un dictado entre los campos de los datos declarados, con reglas y sin modelo. Pensado
 * para dictar recorriendo la pantalla: "Ocupación programador. Peso 140 kilos. Altura 1,84.
 * Actividad física sedentario, camina dos veces por semana. Tiene hipertensión. Antecedentes:
 * se operó la rodilla en 2020". Lo que no reconoce, no lo inventa: la persona revisa antes de
 * cargar.
 */
export function interpretarDictadoDeFicha(dictado: string): FichaDictada {
  // "en el 20-25": el transcriptor parte los años; se juntan antes de leer.
  const original = dictado.normalize('NFC').replace(/\b(19|20)-(\d{2})\b/g, '$1$2');
  // Mismo largo que el original (cada letra con tilde queda en una): los índices sirven para los dos.
  const plano = original.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').toLowerCase();
  const partes = partir(original, plano);

  return {
    ocupacion: ocupacionDe(partes.get('ocupacion')),
    pesoKg: pesoDe(plano),
    alturaCm: alturaDe(plano),
    ...(partes.has('actividad')
      ? actividadDe(partes.get('actividad'), false)
      : actividadDe(antesDeAntecedentes(original, plano), true)),
    condiciones: condicionesDe(plano),
    antecedentes: antecedentesDe(partes.get('antecedentes')),
  };
}

interface Tramo {
  readonly original: string;
  readonly plano: string;
}

/** Corta el dictado en partes desde cada marca hasta la siguiente, sin la palabra de la marca. */
function partir(original: string, plano: string): Map<Parte, Tramo> {
  const inicios: { parte: Parte; desde: number; cuerpo: number }[] = [];
  for (const [parte, marca] of MARCAS) {
    const hallada = marca.exec(plano);
    if (hallada) {
      inicios.push({ parte, desde: hallada.index, cuerpo: hallada.index + hallada[0].length });
    }
  }
  inicios.sort((a, b) => a.desde - b.desde);
  const partes = new Map<Parte, Tramo>();
  inicios.forEach((inicio, i) => {
    const hasta = i + 1 < inicios.length ? inicios[i + 1].desde : plano.length;
    partes.set(inicio.parte, {
      original: original.slice(inicio.cuerpo, hasta),
      plano: plano.slice(inicio.cuerpo, hasta),
    });
  });
  return partes;
}

/** Frases de un tramo: corta en puntos, comas, punto y coma e "y". */
function frases(tramo: Tramo): Tramo[] {
  const cortes = /[.,;:]|\s+y\s+/g;
  const resultado: Tramo[] = [];
  let desde = 0;
  for (const corte of tramo.plano.matchAll(cortes)) {
    resultado.push(recortar(tramo, desde, corte.index));
    desde = corte.index + corte[0].length;
  }
  resultado.push(recortar(tramo, desde, tramo.plano.length));
  return resultado.filter((f) => f.plano !== '');
}

function recortar(tramo: Tramo, desde: number, hasta: number): Tramo {
  const original = tramo.original.slice(desde, hasta);
  const plano = tramo.plano.slice(desde, hasta);
  const izquierda = plano.length - plano.trimStart().length;
  const derecha = plano.trimEnd().length;
  return { original: original.slice(izquierda, derecha), plano: plano.slice(izquierda, derecha) };
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function numero(texto: string): number {
  return Number(texto.replace(',', '.'));
}

function ocupacionDe(tramo: Tramo | undefined): string | undefined {
  const primera = tramo ? frases(tramo)[0] : undefined;
  if (!primera) {
    return undefined;
  }
  const limpia = primera.original.replace(/^(es|de|como)\s+/i, '').trim();
  return limpia ? capitalizar(limpia).slice(0, 80) : undefined;
}

function pesoDe(plano: string): number | undefined {
  const hallado = /\b(?:peso|pesa)\b[^\d]{0,12}(\d{1,3}(?:[.,]\d)?)/.exec(plano);
  if (!hallado) {
    return undefined;
  }
  const peso = numero(hallado[1]);
  return peso >= 1 && peso <= 400 ? peso : undefined;
}

function alturaDe(plano: string): number | undefined {
  const hallado =
    /\b(?:altura|estatura|mide)\b[^\d]{0,12}(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(?:m|metros?)\s*(?:con\s*)?(\d{1,2})\b)?/.exec(
      plano,
    );
  if (!hallado) {
    return undefined;
  }
  let valor = numero(hallado[1]);
  // "1,84" o "1 metro 84" en metros; "184" ya viene en centímetros.
  if (valor < 3) {
    valor = hallado[2] ? Math.trunc(valor) * 100 + Number(hallado[2]) : Math.round(valor * 100);
  }
  return valor >= 30 && valor <= 250 ? valor : undefined;
}

/** Todo lo dicho antes de "antecedentes": ahí se busca la actividad cuando no se la nombró. */
function antesDeAntecedentes(original: string, plano: string): Tramo {
  const hasta = /\bantecedentes?\b/.exec(plano)?.index ?? plano.length;
  return { original: original.slice(0, hasta), plano: plano.slice(0, hasta) };
}

/**
 * Nivel y detalle de la actividad. Con `suelta` el tramo es todo el dictado sin la parte de
 * antecedentes: solo cuentan las frases que dicen qué hace ("juega al fútbol dos veces por semana").
 */
function actividadDe(
  tramo: Tramo | undefined,
  suelta: boolean,
): Pick<FichaDictada, 'actividad' | 'detalle'> {
  if (!tramo) {
    return {};
  }
  let actividad: FichaDeIngresoRequestActividadEnum | undefined;
  const resto: string[] = [];
  for (const frase of frases(tramo)) {
    const nivel = NIVELES_DE_ACTIVIDAD.find(([, palabras]) => palabras.test(frase.plano));
    if (nivel) {
      actividad ??= nivel[0];
      continue;
    }
    if (/^fisica$/.test(frase.plano) || (suelta && !HACE_ACTIVIDAD.test(frase.plano))) {
      continue;
    }
    resto.push(frase.original.replace(CONECTOR_INICIAL, ''));
  }
  const detalle = resto.join(', ').trim();
  return {
    ...(actividad ? { actividad } : {}),
    ...(detalle ? { detalle: capitalizar(detalle).slice(0, 120) } : {}),
  };
}

/** Condiciones nombradas en cualquier parte del dictado, salvo las negadas en su misma frase. */
function condicionesDe(plano: string): string[] {
  const frasesPlanas = frases({ original: plano, plano }).map((f) => f.plano);
  const halladas: string[] = [];
  for (const [codigo, raices] of Object.entries(SINONIMOS_DE_CONDICION)) {
    const dicha = frasesPlanas.some((frase) =>
      raices.some((raiz) => {
        const donde = frase.indexOf(raiz);
        return donde >= 0 && !NEGACION.test(frase.slice(0, donde));
      }),
    );
    if (dicha) {
      halladas.push(codigo);
    }
  }
  return halladas;
}

function antecedentesDe(tramo: Tramo | undefined): AntecedenteDictado[] {
  if (!tramo) {
    return [];
  }
  const antecedentes: AntecedenteDictado[] = [];
  let tipoNombrado: AntecedenteResponseTipoEnum | undefined;
  for (const frase of frases(tramo)) {
    if (NEGACION.test(frase.plano)) {
      continue;
    }
    const tipo = TIPOS_POR_PALABRA.find(([, palabras]) => palabras.test(frase.plano))?.[0];
    // "Médicos", "algo quirúrgico": un rótulo que dice de qué tipo es lo que sigue, no un dato.
    const sinRelleno = frase.plano.replace(RELLENO_DE_ROTULO, '');
    if (tipo && sinRelleno.split(/\s+/).length <= 2) {
      tipoNombrado = tipo;
      continue;
    }
    // Una condición de la ficha ya se carga con su tilde.
    if (
      Object.values(SINONIMOS_DE_CONDICION).some((r) =>
        r.some((raiz) => frase.plano.includes(raiz)),
      )
    ) {
      continue;
    }
    const tipoFinal = tipo ?? tipoNombrado ?? AntecedenteResponseTipoEnum.MEDICO;
    antecedentes.push(armarAntecedente(frase, tipoFinal));
  }
  return antecedentes;
}

function armarAntecedente(frase: Tramo, tipo: AntecedenteResponseTipoEnum): AntecedenteDictado {
  const texto = frase.original.replace(CONECTOR_INICIAL, '');
  if (tipo !== AntecedenteResponseTipoEnum.QUIRURGICO) {
    return { tipo, descripcion: capitalizar(texto).slice(0, 1000) };
  }
  const anioHallado = /\b(19\d{2}|20\d{2})\b/.exec(frase.plano);
  const anio = anioHallado ? Number(anioHallado[1]) : undefined;
  const zona = ZONAS_DEL_CUERPO.find((z) =>
    frase.plano.includes(z.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()),
  );
  let descripcion = texto.replace(/\s*(en\s+(el\s+)?(año\s+)?)?\b(19|20)\d{2}\b/i, '').trim();
  // "La mano derecha" a secas, dicho después de "quirúrgicos": se lee como la operación.
  if (descripcion && !TIPOS_POR_PALABRA[0][1].test(sinTildes(descripcion))) {
    descripcion = `Operación de ${descripcion.charAt(0).toLowerCase()}${descripcion.slice(1)}`;
  }
  return {
    tipo,
    descripcion: capitalizar(descripcion || texto).slice(0, 1000),
    ...(anio && anio <= new Date().getFullYear() ? { anio } : {}),
    ...(zona ? { zona } : {}),
  };
}

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Si el dictado no dejó ningún dato que cargar. */
export function nadaReconocido(ficha: FichaDictada): boolean {
  return (
    !ficha.ocupacion &&
    ficha.pesoKg === undefined &&
    ficha.alturaCm === undefined &&
    !ficha.actividad &&
    !ficha.detalle &&
    ficha.condiciones.length === 0 &&
    ficha.antecedentes.length === 0
  );
}

/** "Ocupación, peso, altura, actividad, 2 condiciones y 1 antecedente": para el aviso. */
export function resumirDictado(ficha: FichaDictada): string {
  const partes = [
    ficha.ocupacion ? 'ocupación' : null,
    ficha.pesoKg !== undefined ? 'peso' : null,
    ficha.alturaCm !== undefined ? 'altura' : null,
    ficha.actividad || ficha.detalle ? 'actividad' : null,
    contar(ficha.condiciones.length, 'condición', 'condiciones'),
    contar(ficha.antecedentes.length, 'antecedente', 'antecedentes'),
  ].filter((parte): parte is string => parte !== null);
  const texto =
    partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : (partes[0] ?? '');
  return capitalizar(texto);
}

function contar(cantidad: number, singular: string, plural: string): string | null {
  return cantidad === 0 ? null : `${cantidad} ${cantidad === 1 ? singular : plural}`;
}
