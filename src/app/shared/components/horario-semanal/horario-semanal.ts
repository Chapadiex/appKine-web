import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';

import { DIAS_DE_LA_SEMANA, etiquetaDeDia } from '../../utils/dias-de-la-semana';
import { cuartosDeHora, minutosDeHora } from '../../utils/horas-de-pared';
import {
  FranjaForm,
  FranjaSemanal,
  FranjasForm,
  MAXIMO_FRANJAS,
  franjasDelFormulario,
  mensajeDeFranja,
  reemplazarFranjas,
} from '../../utils/franjas-semanales';

/** Horario de un dia nuevo cuando no hay otro dia abierto del que copiarlo. */
const HORARIO_POR_DEFECTO = { horaDesde: '09:00', horaHasta: '18:00' } as const;

/** Franjas que admite un dia. Mas que eso ya no es un horario de atencion: es una agenda. */
const MAXIMO_FRANJAS_POR_DIA = 3;

/** Modelos de un clic: lo que carga casi cualquier centro, para no armar la semana dia por dia. */
const MODELOS: readonly {
  readonly id: string;
  readonly rotulo: string;
  readonly franjas: FranjaSemanal[];
}[] = [
  {
    id: 'lv',
    rotulo: 'Lunes a viernes',
    franjas: [1, 2, 3, 4, 5].map((dia) => ({ diaSemana: dia, ...HORARIO_POR_DEFECTO })),
  },
  {
    id: 'ls',
    rotulo: 'Lunes a sábado',
    franjas: [
      ...[1, 2, 3, 4, 5].map((dia) => ({ diaSemana: dia, ...HORARIO_POR_DEFECTO })),
      { diaSemana: 6, horaDesde: '09:00', horaHasta: '13:00' },
    ],
  },
  {
    id: 'semana',
    rotulo: 'Toda la semana',
    franjas: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ diaSemana: dia, ...HORARIO_POR_DEFECTO })),
  },
  {
    id: 'corte',
    rotulo: 'Con corte al mediodía',
    franjas: [1, 2, 3, 4, 5].flatMap((dia) => [
      { diaSemana: dia, horaDesde: '08:00', horaHasta: '13:00' },
      { diaSemana: dia, horaDesde: '15:00', horaHasta: '20:00' },
    ]),
  },
];

/** Una franja del dia, con su indice en la lista: el `400` del backend la nombra por indice. */
interface FranjaDelDia {
  readonly indice: number;
  readonly control: FranjaForm;
}

const CUARTOS = cuartosDeHora();

interface DiaDelEditor {
  readonly numero: number;
  readonly etiqueta: string;
  readonly franjas: readonly FranjaDelDia[];
}

/**
 * Horario semanal en forma de semana: un renglon por dia, con un interruptor de abierto o
 * cerrado y sus horas (refactor del alta de sede, 03/11/2026).
 *
 * <p>Reemplaza en el alta a {@link EditorDeFranjas}, que pedia armar la semana franja por
 * franja —dia, desde, hasta, cinco veces para un lunes a viernes—. <b>Edita el mismo
 * `FormArray`</b> que arma `crearFranjasForm()`, asi que el cuerpo que viaja, las validaciones y
 * los errores del servidor por indice no cambian: cambia solo como se carga.
 *
 * <p>La lista se mantiene <b>ordenada por dia</b>. Los indices que nombra un `400`
 * (`horarioGeneral[2]`) son los del cuerpo enviado, que es esta misma lista en este mismo orden.
 *
 * <p>Las horas se eligen de un desplegable de cuartos de hora (06/11/2026): el campo de texto con
 * `<datalist>` dejaba escribir cualquier cosa. El valor sigue siendo el string del contrato, y el
 * cierre ofrece `24:00` para la medianoche.
 *
 * <p>Como el editor libre, vive en `shared/` y no sabe que es una sede.
 */
@Component({
  selector: 'app-horario-semanal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule],
  templateUrl: './horario-semanal.html',
  styleUrl: './horario-semanal.css',
})
export class HorarioSemanal {
  /** La lista a editar. El componente la muta en el lugar, como el editor libre. */
  readonly franjas = input.required<FranjasForm>();

  /** Prefijo de los `id` de los controles: tiene que ser unico en la pantalla. */
  readonly idBase = input.required<string>();

  /** `true` despues de un intento de envio: muestra los errores aunque el campo no se toco. */
  readonly mostrarErrores = input(false);

  /** Errores que devolvio el backend, por indice de franja. */
  readonly erroresDelServidor = input<ReadonlyMap<number, string>>(new Map());

  protected readonly modelos = MODELOS;
  /** Abrir va de 00:00 a 23:45; cerrar, de 00:15 a 24:00 (medianoche). */
  protected readonly horasDeApertura = CUARTOS.slice(0, -1);
  protected readonly horasDeCierre = CUARTOS.slice(1);

  /** Con OnPush, el padre que muta la misma instancia no dispara nada: se escucha la lista. */
  private readonly cambios = signal(0);

  protected readonly dias = computed<readonly DiaDelEditor[]>(() => {
    this.cambios();
    const controles = this.franjas().controls;
    return DIAS_DE_LA_SEMANA.map((dia) => ({
      numero: dia.numero,
      etiqueta: etiquetaDeDia(dia.numero),
      franjas: controles
        .map((control, indice) => ({ indice, control }))
        .filter(({ control }) => control.controls.diaSemana.value === dia.numero),
    }));
  });

  protected readonly resumen = computed(() => {
    this.cambios();
    const franjas = franjasDelFormulario(this.franjas());
    const abiertos = new Set(franjas.map((franja) => franja.diaSemana)).size;
    if (abiertos === 0) {
      return 'Sin horario: la agenda no se limita';
    }
    const minutos = franjas.reduce((total, franja) => {
      const desde = minutosDeHora(franja.horaDesde);
      const hasta = minutosDeHora(franja.horaHasta);
      return desde === null || hasta === null || hasta <= desde ? total : total + hasta - desde;
    }, 0);
    const horas = (Math.round((minutos / 60) * 10) / 10).toLocaleString('es-AR');
    return `Abre ${abiertos} ${abiertos === 1 ? 'día' : 'días'} · ${horas} h por semana`;
  });

  /** El modelo que coincide con lo cargado, para marcarlo como elegido. */
  protected readonly modeloActual = computed(() => {
    this.cambios();
    const actual = JSON.stringify(franjasDelFormulario(this.franjas()));
    return MODELOS.find((modelo) => JSON.stringify(modelo.franjas) === actual)?.id ?? null;
  });

  /** Copiar el lunes solo tiene sentido si el lunes abre y hay otro dia abierto. */
  protected readonly puedeCopiarLunes = computed(() => {
    const abiertos = this.dias().filter((dia) => dia.franjas.length > 0);
    return abiertos.length > 1 && abiertos[0].numero === 1;
  });

  /** El tope total lo pone el backend; se replica solo para no ofrecer un boton que falla. */
  protected readonly hayLugar = computed(() => {
    this.cambios();
    return this.franjas().length < MAXIMO_FRANJAS;
  });

  constructor() {
    effect((alLimpiar) => {
      const suscripcion = this.franjas().events.subscribe(() =>
        this.cambios.update((valor) => valor + 1),
      );
      alLimpiar(() => suscripcion.unsubscribe());
    });
  }

  protected aplicarModelo(id: string): void {
    const modelo = MODELOS.find((candidato) => candidato.id === id);
    if (modelo !== undefined) {
      reemplazarFranjas(this.franjas(), modelo.franjas);
    }
  }

  /** Abre el dia con el horario del primer dia abierto, o lo cierra quitando sus franjas. */
  protected alternarDia(dia: DiaDelEditor): void {
    const actuales = franjasDelFormulario(this.franjas());
    if (dia.franjas.length > 0) {
      this.guardar(actuales.filter((franja) => franja.diaSemana !== dia.numero));
      return;
    }
    const referencia = actuales.length > 0 ? delDia(actuales, actuales[0].diaSemana) : null;
    const nuevas = referencia ?? [{ diaSemana: dia.numero, ...HORARIO_POR_DEFECTO }];
    this.guardar([...actuales, ...nuevas.map((franja) => ({ ...franja, diaSemana: dia.numero }))]);
  }

  /**
   * Parte el dia en mañana y tarde, o lo vuelve a unir.
   *
   * <p>Al partir, el corte va de 13 a 14 si cae adentro del horario; si no, la segunda franja
   * queda vacia para que la complete quien carga. Al unir, queda una sola franja del inicio de
   * la primera al fin de la ultima, tenga el dia dos franjas o tres.
   */
  protected alternarCorte(dia: DiaDelEditor): void {
    const actuales = franjasDelFormulario(this.franjas());
    const propias = delDia(actuales, dia.numero) ?? [];
    const resto = actuales.filter((franja) => franja.diaSemana !== dia.numero);
    if (propias.length === 0) {
      return;
    }
    const primera = propias[0];
    if (propias.length > 1) {
      const ultima = propias[propias.length - 1];
      this.guardar([...resto, { ...primera, horaHasta: ultima.horaHasta }]);
      return;
    }
    const desde = minutosDeHora(primera.horaDesde);
    const hasta = minutosDeHora(primera.horaHasta);
    const cabeElMediodia = desde !== null && hasta !== null && desde < 13 * 60 && hasta > 14 * 60;
    const partido = cabeElMediodia
      ? [
          { ...primera, horaHasta: '13:00' },
          { ...primera, horaDesde: '14:00' },
        ]
      : [primera, { diaSemana: dia.numero, horaDesde: '', horaHasta: '' }];
    this.guardar([...resto, ...partido]);
  }

  /** Un dia ya partido puede sumar una franja mas, vacia, hasta el tope por dia. */
  protected puedeAgregarFranja(dia: DiaDelEditor): boolean {
    return (
      dia.franjas.length >= 2 && dia.franjas.length < MAXIMO_FRANJAS_POR_DIA && this.hayLugar()
    );
  }

  /** Agrega una franja vacia al final del dia: quien carga escribe las dos horas. */
  protected agregarFranja(dia: DiaDelEditor): void {
    if (!this.puedeAgregarFranja(dia)) {
      return;
    }
    const actuales = franjasDelFormulario(this.franjas());
    this.guardar([...actuales, { diaSemana: dia.numero, horaDesde: '', horaHasta: '' }]);
  }

  /** "Quitar" solo aparece con tres franjas: con dos, el camino de vuelta es "Sin corte". */
  protected puedeQuitarFranja(dia: DiaDelEditor): boolean {
    return dia.franjas.length >= MAXIMO_FRANJAS_POR_DIA;
  }

  /** Saca una franja puntual del dia. El resto conserva su orden y el dia sigue abierto. */
  protected quitarFranja(indice: number): void {
    const actuales = franjasDelFormulario(this.franjas());
    this.guardar(actuales.filter((_, posicion) => posicion !== indice));
  }

  /** Lleva el horario del lunes a cada dia abierto. Los cerrados siguen cerrados. */
  protected copiarLunes(): void {
    const actuales = franjasDelFormulario(this.franjas());
    const lunes = delDia(actuales, 1);
    if (lunes === null) {
      return;
    }
    const abiertos = [...new Set(actuales.map((franja) => franja.diaSemana))];
    this.guardar(abiertos.flatMap((dia) => lunes.map((franja) => ({ ...franja, diaSemana: dia }))));
  }

  protected mensaje(indice: number): string | null {
    return mensajeDeFranja(
      this.franjas(),
      indice,
      this.mostrarErrores(),
      this.erroresDelServidor(),
    );
  }

  /** El primer error del dia, con el indice de la franja que lo tiene. */
  protected errorDelDia(
    dia: DiaDelEditor,
  ): { readonly indice: number; readonly texto: string } | null {
    for (const { indice } of dia.franjas) {
      const texto = this.mensaje(indice);
      if (texto !== null) {
        return { indice, texto };
      }
    }
    return null;
  }

  /** Lo que el lector de pantalla agrega al rotulo de la hora: cual de las franjas del dia es. */
  protected sufijoDeFranja(posicion: number): string {
    if (posicion === 0) {
      return '';
    }
    return posicion === 1 ? ' (después del corte)' : ` (franja ${posicion + 1})`;
  }

  /** Reemplaza la lista ordenada por dia: el orden es el del cuerpo y el de los indices. */
  private guardar(franjas: readonly FranjaSemanal[]): void {
    reemplazarFranjas(
      this.franjas(),
      [...franjas].sort((una, otra) => una.diaSemana - otra.diaSemana),
    );
  }
}

function delDia(franjas: readonly FranjaSemanal[], dia: number): FranjaSemanal[] | null {
  const propias = franjas.filter((franja) => franja.diaSemana === dia);
  return propias.length === 0 ? null : propias;
}
