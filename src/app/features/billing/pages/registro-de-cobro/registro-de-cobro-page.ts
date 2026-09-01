import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { BillingApi } from '../../services/billing-api';
import { Cobro } from '../../../../api/generated/model/cobro';
import { MedioDeCobroMedioEnum } from '../../../../api/generated/model/medio-de-cobro';
import { Obligacion, ObligacionEstadoEnum } from '../../../../api/generated/model/obligacion';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { ErrorCobro, traducirErrorCobro } from '../../models/cobro-errors';
import { MEDIOS_DE_COBRO, medioEnPalabras } from '../../models/etiquetas-de-cobro';
import { fechaEnPalabras, importeEnPalabras } from '../../models/etiquetas-de-obligacion';
import {
  aCentavos,
  centavosDeTexto,
  deCentavos,
  sumaDeCentavos,
  textoDeCentavos,
} from '../../models/dinero';

/** Un medio de pago que se esta cargando. `id` es solo para el `track` del `@for`. */
interface LineaDeMedio {
  readonly id: number;
  readonly medio: MedioDeCobroMedioEnum;
  /** Lo que el operador tipeo, sin parsear. La conversion a centavos ocurre al validar. */
  readonly importe: string;
  readonly referencia: string;
}

/** En cual de los tres estados esta la carga de la cuenta corriente. */
type EstadoDeuda =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly deudas: readonly Obligacion[] }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/**
 * Registro de un cobro (M19, AKINE-07.02).
 *
 * <p>Cuelga de la cuenta corriente —`/pacientes/:personaId/cuenta-corriente/cobrar`— porque no se
 * puede llegar de otra forma: cobrar sin saber contra que deuda no existe en este producto. Los
 * anticipos son AKINE-07.03 y necesitan la Caja.
 *
 * <h2>1. Esto NO es la caja</h2>
 *
 * <p>Deuda, cobro y caja son tres cosas distintas (regla maestra 5, M18/M19/M20). Esta pantalla
 * registra <b>dinero recibido</b> y lo imputa a deuda; no abre turno de caja, no arquea y no dice
 * donde quedo la plata. Presentarla como "cobrar en caja" haria creer que el arqueo del dia ya
 * esta contemplado, y no lo esta: la Caja no existe todavia.
 *
 * <h2>2. Toda la aritmetica es en centavos enteros</h2>
 *
 * <p>El servidor exige que <b>la suma de los medios y la suma de las imputaciones den el total</b>
 * y rechaza con 400 `cobro-no-cuadra` cualquier diferencia de un centavo. Verificarlo antes de
 * mandar exige sumar, y sumar con `number` es un defecto real: `0.1 + 0.2` no da `0.3`, asi que un
 * cobro valido quedaria bloqueado o —peor— uno invalido pasaria el control local. Todos los
 * importes viven como enteros de centavos (`models/dinero.ts`) desde que se tipean hasta que se
 * arma el cuerpo, y lo que se tipea se parsea <b>desde el texto</b>, sin pasar por `parseFloat`.
 *
 * <h2>3. El saldo no puede quedar negativo, y la pantalla lo dice dos veces</h2>
 *
 * <p>Antes: ninguna imputacion puede superar el saldo que se leyo, y el campo lo marca en el
 * momento. Despues: si otro cobro se llevo la plata en el medio, el backend responde 409
 * `saldo-insuficiente` —lo garantiza con `UPDATE ... WHERE saldo >= :importe`— y eso se muestra
 * como <b>lo que es</b>, la garantia funcionando, con el boton de recargar al lado. Mostrarlo como
 * "error inesperado" haria que el administrativo reintente lo mismo, que va a fallar igual.
 *
 * <h2>4. La clave de idempotencia se ata a la composicion del cobro</h2>
 *
 * <p>Un doble click sin clave cobra dos veces y emite dos comprobantes correlativos. La clave se
 * genera al confirmar y <b>se descarta ante cualquier edicion</b>: reusarla con otro contenido es
 * exactamente el 409 `idempotency-key-conflict`. Reintentar sin tocar nada reusa la misma, que es
 * para lo que existe.
 *
 * <h2>5. El caso que rompe la pantalla</h2>
 *
 * <p>Cambiar de organizacion o de consultorio con el formulario a medio cargar. El `effect` de
 * contexto tira todo —deudas, seleccion, medios, clave— y recarga: imputar contra obligaciones de
 * otra organizacion es la fuga de tenant que el aislamiento existe para evitar. El otro caso es la
 * persona sin deuda cobrable, que se resuelve con un mensaje y no con un formulario vacio.
 */
@Component({
  selector: 'app-registro-de-cobro-page',
  imports: [RouterLink],
  templateUrl: './registro-de-cobro-page.html',
  styleUrl: '../../billing.css',
})
export class RegistroDeCobroPage {
  private readonly api = inject(BillingApi);
  private readonly tenantContext = inject(TenantContextStore);

  /** De la ruta padre. `withComponentInputBinding` lo liga solo. */
  readonly personaId = input.required<string>();

  protected readonly mediosDisponibles = MEDIOS_DE_COBRO;
  protected readonly medioEnPalabras = medioEnPalabras;
  protected readonly fechaEnPalabras = fechaEnPalabras;

  protected readonly estado = signal<EstadoDeuda>({ tipo: 'cargando' });
  protected readonly persona = signal<PersonaResponse | null>(null);

  /** Importe tipeado por obligacion elegida. Estar en el mapa ES estar elegida. */
  protected readonly imputaciones = signal<ReadonlyMap<number, string>>(new Map());

  protected readonly medios = signal<readonly LineaDeMedio[]>([nuevoMedio(0)]);

  protected readonly enviando = signal(false);
  protected readonly error = signal<ErrorCobro | null>(null);
  protected readonly cobro = signal<Cobro | null>(null);

  private readonly claveDeIntento = signal('');
  private siguienteId = 1;

  // -------------------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------------------

  protected readonly cargando = computed(() => this.estado().tipo === 'cargando');

  protected readonly deudas = computed<readonly Obligacion[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.deudas : [];
  });

  protected readonly mensajeDeCarga = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  protected readonly sinDeudaCobrable = computed(
    () => this.estado().tipo === 'listo' && this.deudas().length === 0,
  );

  protected readonly nombreDeLaPersona = computed(() => {
    const ficha = this.persona();
    if (ficha === null) {
      return '';
    }
    return `${ficha.apellido ?? ''}, ${ficha.nombre ?? ''}`.trim();
  });

  /** `true` una vez que el cobro entro. El formulario se reemplaza por el comprobante. */
  protected readonly registrado = computed(() => this.cobro() !== null);

  /**
   * Las dos rutas hermanas, absolutas.
   *
   * <p>Absolutas y no `..`: el enlace relativo depende de la ruta activa y se rompe en silencio el
   * dia que esta pantalla se monte en otro lado, que es exactamente el tipo de rotura que nadie
   * ve hasta que un usuario cae en el 404.
   */
  protected readonly rutaCuenta = computed(() => `/pacientes/${this.personaId()}/cuenta-corriente`);
  protected readonly rutaCobros = computed(() => `${this.rutaCuenta()}/cobros`);

  /**
   * La moneda de las deudas elegidas.
   *
   * <p>Sale del dato y no de una constante. Si las elegidas no coinciden es `null` y el cobro no
   * se puede armar: un solo cobro mezcla un solo tipo de plata, y el backend lo rechaza igual.
   */
  protected readonly moneda = computed<string | null>(() => {
    const elegidas = this.obligacionesElegidas();
    if (elegidas.length === 0) {
      return null;
    }
    const primera = elegidas[0].moneda ?? '';
    return elegidas.every((deuda) => (deuda.moneda ?? '') === primera) ? primera : null;
  });

  // -------------------------------------------------------------------------------------
  // Totales — todo en centavos enteros
  // -------------------------------------------------------------------------------------

  private readonly obligacionesElegidas = computed<readonly Obligacion[]>(() => {
    const elegidas = this.imputaciones();
    return this.deudas().filter((deuda) => deuda.id !== undefined && elegidas.has(deuda.id));
  });

  /** Centavos imputados, o `null` si algun importe tipeado no es un numero. */
  protected readonly totalImputado = computed<number | null>(() => {
    const elegidas = this.imputaciones();
    if (elegidas.size === 0) {
      return null;
    }
    const centavos: number[] = [];
    for (const texto of elegidas.values()) {
      const valor = centavosDeTexto(texto);
      if (valor === null || valor <= 0) {
        return null;
      }
      centavos.push(valor);
    }
    return sumaDeCentavos(centavos);
  });

  /** Centavos recibidos por todos los medios, o `null` si alguno no es un numero. */
  protected readonly totalDeMedios = computed<number | null>(() => {
    const lineas = this.medios();
    if (lineas.length === 0) {
      return null;
    }
    const centavos: number[] = [];
    for (const linea of lineas) {
      const valor = centavosDeTexto(linea.importe);
      if (valor === null || valor <= 0) {
        return null;
      }
      centavos.push(valor);
    }
    return sumaDeCentavos(centavos);
  });

  protected readonly totalImputadoEnPalabras = computed(() =>
    this.enPalabras(this.totalImputado()),
  );
  protected readonly totalDeMediosEnPalabras = computed(() =>
    this.enPalabras(this.totalDeMedios()),
  );

  /**
   * Lo que falta para poder confirmar, en orden de lectura.
   *
   * <p>Se muestra siempre y no solo al apretar: un boton deshabilitado sin explicacion deja al
   * operador probando cosas. Cada entrada es una frase accionable, no un codigo.
   */
  protected readonly problemas = computed<readonly string[]>(() => {
    const faltantes: string[] = [];
    const elegidas = this.imputaciones();

    if (elegidas.size === 0) {
      faltantes.push('Eligi al menos una deuda para imputar el cobro.');
    }

    const imputado = this.totalImputado();
    if (elegidas.size > 0 && imputado === null) {
      faltantes.push('Hay un importe a imputar que no es un numero mayor que cero.');
    }

    for (const deuda of this.excedidas()) {
      faltantes.push(
        `No se puede imputar mas que el saldo de "${deuda.snapshotNombre ?? 'la prestacion'}": ` +
          `${this.saldoEnPalabras(deuda)}. Un saldo no puede quedar negativo.`,
      );
    }

    if (this.moneda() === null && elegidas.size > 0) {
      faltantes.push('Las deudas elegidas estan en monedas distintas. Un cobro es de una sola.');
    }

    const recibido = this.totalDeMedios();
    if (recibido === null) {
      faltantes.push('Hay un medio de pago sin importe, o con un importe que no es un numero.');
    }

    if (imputado !== null && recibido !== null && imputado !== recibido) {
      faltantes.push(
        `Los medios suman ${this.totalDeMediosEnPalabras()} y las imputaciones ` +
          `${this.totalImputadoEnPalabras()}. Tienen que dar lo mismo: el servidor rechaza la ` +
          'diferencia y no registra nada.',
      );
    }

    return faltantes;
  });

  protected readonly puedeConfirmar = computed(
    () => this.problemas().length === 0 && !this.enviando() && !this.registrado(),
  );

  /** Deudas cuya imputacion supera el saldo leido. Es lo que impide dejar un saldo negativo. */
  private readonly excedidas = computed<readonly Obligacion[]>(() =>
    this.obligacionesElegidas().filter((deuda) => this.excede(deuda)),
  );

  constructor() {
    effect(() => {
      // Depende de la ruta y del contexto: cambiar de sede o de organizacion invalida las deudas
      // que se estan por imputar, y con ellas todo el formulario.
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => this.reiniciar());
    });
  }

  // -------------------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------------------

  /**
   * Relee la cuenta corriente y descarta la seleccion.
   *
   * <p>La seleccion no se conserva a proposito: los saldos que la justificaban acaban de cambiar,
   * y reponerla sobre numeros nuevos es como el operador termina imputando un importe que ya no
   * corresponde sin haberlo mirado.
   */
  protected recargar(): void {
    this.imputaciones.set(new Map());
    this.medios.set([nuevoMedio(this.siguienteId++)]);
    this.claveDeIntento.set('');
    this.error.set(null);
    this.cobro.set(null);
    this.cargar();
  }

  protected cargar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const personaId = this.numeroDePersona();
    if (consultorioId === null || personaId === null) {
      this.estado.set({
        tipo: 'error',
        mensaje:
          'Para registrar un cobro hay que saber en que sede estas: el comprobante se numera por ' +
          'sede. Eligi una organizacion y un consultorio, y volve a entrar.',
        faltaContexto: true,
      });
      return;
    }

    this.estado.set({ tipo: 'cargando' });

    // La ficha es el encabezado y su fallo se descarta: perder el cobro entero porque no cargo un
    // apellido seria peor.
    this.api
      .verPersona(personaId)
      .pipe(catchError(() => of(null)))
      .subscribe((ficha) => this.persona.set(ficha));

    this.api.deLaPersona(consultorioId, personaId).subscribe({
      next: (obligaciones) =>
        this.estado.set({ tipo: 'listo', deudas: obligaciones.filter(esCobrable) }),
      error: (error: unknown) => {
        const traducido = traducirErrorCobro(error);
        this.estado.set({
          tipo: 'error',
          mensaje: traducido.mensaje,
          faltaContexto: traducido.causa === 'sin-contexto',
        });
      },
    });
  }

  // -------------------------------------------------------------------------------------
  // Imputaciones
  // -------------------------------------------------------------------------------------

  protected estaElegida(deuda: Obligacion): boolean {
    return deuda.id !== undefined && this.imputaciones().has(deuda.id);
  }

  /**
   * Marca o desmarca una deuda.
   *
   * <p>Al marcarla se propone <b>el saldo completo</b>, que es lo que pasa en el mostrador la
   * enorme mayoria de las veces. Es editable: los pagos parciales existen.
   */
  protected alternar(deuda: Obligacion): void {
    if (deuda.id === undefined) {
      return;
    }
    const copia = new Map(this.imputaciones());
    if (copia.has(deuda.id)) {
      copia.delete(deuda.id);
    } else {
      copia.set(deuda.id, textoDeCentavos(this.saldoEnCentavos(deuda)));
    }
    this.imputaciones.set(copia);
    this.otroIntento();
  }

  protected importeDe(deuda: Obligacion): string {
    return deuda.id === undefined ? '' : (this.imputaciones().get(deuda.id) ?? '');
  }

  protected cambiarImporte(deuda: Obligacion, texto: string): void {
    if (deuda.id === undefined || !this.imputaciones().has(deuda.id)) {
      return;
    }
    const copia = new Map(this.imputaciones());
    copia.set(deuda.id, texto);
    this.imputaciones.set(copia);
    this.otroIntento();
  }

  /** `true` si lo tipeado supera el saldo leido, o no es un importe. Pinta el campo. */
  protected excede(deuda: Obligacion): boolean {
    if (!this.estaElegida(deuda)) {
      return false;
    }
    const pedido = centavosDeTexto(this.importeDe(deuda));
    if (pedido === null || pedido <= 0) {
      return true;
    }
    return pedido > this.saldoEnCentavos(deuda);
  }

  protected saldoEnPalabras(deuda: Obligacion): string {
    return importeEnPalabras(deuda.saldo, deuda.moneda);
  }

  protected importeOriginalEnPalabras(deuda: Obligacion): string {
    return importeEnPalabras(deuda.importeOriginal, deuda.moneda);
  }

  // -------------------------------------------------------------------------------------
  // Medios de pago
  // -------------------------------------------------------------------------------------

  protected agregarMedio(): void {
    this.medios.update((lineas) => [...lineas, nuevoMedio(this.siguienteId++)]);
    this.otroIntento();
  }

  protected quitarMedio(linea: LineaDeMedio): void {
    this.medios.update((lineas) => lineas.filter((otra) => otra.id !== linea.id));
    this.otroIntento();
  }

  protected cambiarMedio(linea: LineaDeMedio, medio: string): void {
    this.reemplazar(linea, { medio: medio as MedioDeCobroMedioEnum });
  }

  protected cambiarImporteDeMedio(linea: LineaDeMedio, importe: string): void {
    this.reemplazar(linea, { importe });
  }

  protected cambiarReferencia(linea: LineaDeMedio, referencia: string): void {
    this.reemplazar(linea, { referencia });
  }

  /** `true` si el importe de este medio no es un numero mayor que cero. Pinta el campo. */
  protected medioInvalido(linea: LineaDeMedio): boolean {
    const valor = centavosDeTexto(linea.importe);
    return valor === null || valor <= 0;
  }

  /**
   * Completa el medio con lo que falta para llegar al total imputado.
   *
   * <p>Es el atajo del mostrador: se eligen las deudas, se aprieta esto y el efectivo queda
   * cargado por el importe exacto. Sin el, el operador copia a mano un numero que la pantalla ya
   * sabe, y ahi es donde se tipea un cero de menos.
   *
   * <p>Solo aparece con un unico medio cargado: con dos o mas, cual completar es una decision del
   * operador y no de la pantalla.
   */
  protected completarConElTotal(linea: LineaDeMedio): void {
    const imputado = this.totalImputado();
    if (imputado === null) {
      return;
    }
    this.reemplazar(linea, { importe: textoDeCentavos(imputado) });
  }

  protected readonly puedeCompletar = computed(
    () => this.medios().length === 1 && this.totalImputado() !== null,
  );

  // -------------------------------------------------------------------------------------
  // Confirmacion
  // -------------------------------------------------------------------------------------

  /**
   * Registra el cobro.
   *
   * <p>El cuerpo se arma con `deCentavos` una sola vez por importe, al final: adentro de la
   * pantalla no hubo ni una suma de flotantes.
   */
  protected confirmar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const personaId = this.numeroDePersona();
    const total = this.totalImputado();
    if (consultorioId === null || personaId === null || total === null || !this.puedeConfirmar()) {
      return;
    }

    const imputaciones = this.obligacionesElegidas().flatMap((deuda) => {
      const centavos = centavosDeTexto(this.importeDe(deuda));
      return deuda.id === undefined || centavos === null
        ? []
        : [{ obligacionId: deuda.id, importe: deCentavos(centavos) }];
    });

    const medios = this.medios().flatMap((linea) => {
      const centavos = centavosDeTexto(linea.importe);
      return centavos === null
        ? []
        : [
            {
              medio: linea.medio,
              importe: deCentavos(centavos),
              ...(linea.referencia.trim() === '' ? {} : { referencia: linea.referencia.trim() }),
            },
          ];
    });

    this.enviando.set(true);
    this.error.set(null);

    this.api
      .registrarCobro(consultorioId, {
        personaId,
        total: deCentavos(total),
        imputaciones,
        medios,
        idempotencyKey: this.claveDelIntento(),
      })
      .subscribe({
        next: (cobro) => {
          this.enviando.set(false);
          this.cobro.set(cobro);
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorCobro(error);
          this.error.set(traducido);

          // La clave se quema sola en el unico caso donde reusarla vuelve a fallar seguro.
          if (traducido.causa === 'clave-reusada') {
            this.claveDeIntento.set('');
          }
        },
      });
  }

  /** Accion de `reintentar-con-clave-nueva`. La clave ya se limpio al recibir el 409. */
  protected reintentar(): void {
    this.error.set(null);
    this.confirmar();
  }

  protected mensajeDeMedios(cobro: Cobro): string {
    const lineas = cobro.medios ?? [];
    return lineas
      .map(
        (medio) =>
          `${medioEnPalabras(medio.medio)} ${importeEnPalabras(medio.importe, cobro.moneda)}`,
      )
      .join(' · ');
  }

  protected totalDelCobro(cobro: Cobro): string {
    return importeEnPalabras(cobro.total, cobro.moneda);
  }

  /**
   * Un importe que vino dentro de un `ProblemDetail`, formateado.
   *
   * <p>La moneda no viaja en el problema —es un dato de la obligacion— asi que se usa la de las
   * deudas elegidas. Si no hay una sola, se muestra el numero pelado antes que un simbolo que
   * podria estar mintiendo.
   */
  protected importeDelRechazo(valor: number | null): string {
    return valor === null ? '' : importeEnPalabras(valor, this.moneda() ?? undefined);
  }

  // -------------------------------------------------------------------------------------
  // Interno
  // -------------------------------------------------------------------------------------

  private enPalabras(centavos: number | null): string {
    if (centavos === null) {
      return '';
    }
    return importeEnPalabras(deCentavos(centavos), this.moneda() ?? undefined);
  }

  private saldoEnCentavos(deuda: Obligacion): number {
    return aCentavos(deuda.saldo) ?? 0;
  }

  private reemplazar(linea: LineaDeMedio, cambio: Partial<LineaDeMedio>): void {
    this.medios.update((lineas) =>
      lineas.map((otra) => (otra.id === linea.id ? { ...otra, ...cambio } : otra)),
    );
    this.otroIntento();
  }

  private reiniciar(): void {
    this.imputaciones.set(new Map());
    this.medios.set([nuevoMedio(this.siguienteId++)]);
    this.claveDeIntento.set('');
    this.error.set(null);
    this.cobro.set(null);
    this.persona.set(null);
    this.cargar();
  }

  /**
   * Cualquier edicion invalida la clave del intento anterior.
   *
   * <p>El backend guarda una huella del pedido junto con la clave: reusarla con otro contenido es
   * 409 `idempotency-key-conflict`, no el cobro anterior. Descartarla en cada cambio es lo que
   * mantiene la equivalencia "una clave = una composicion del cobro".
   */
  private otroIntento(): void {
    this.claveDeIntento.set('');
    this.error.set(null);
  }

  /**
   * La clave del intento, generandola si todavia no existe.
   *
   * <p>`crypto.randomUUID` no esta en contextos inseguros ni en algunos runtimes de test, asi que
   * hay respaldo: una clave debil solo es peor que ninguna si se repite, y esta no se repite
   * dentro de una sesion.
   */
  private claveDelIntento(): string {
    const actual = this.claveDeIntento();
    if (actual !== '') {
      return actual;
    }
    const nueva =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `akine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.claveDeIntento.set(nueva);
    return nueva;
  }

  private numeroDePersona(): number | null {
    const id = Number(this.personaId());
    return Number.isFinite(id) && id > 0 ? id : null;
  }
}

/**
 * Una deuda se puede cobrar si no esta anulada, no esta pagada y le queda saldo.
 *
 * <p>Es <b>solo UX</b>: el backend rechaza igual con 409 `obligacion-no-cobrable` y es la
 * autoridad. Lo que evita es ofrecer una fila que sabemos que va a fallar, y sobre todo evita que
 * el operador imputa contra una deuda ya saldada creyendo que descontaba algo.
 */
function esCobrable(deuda: Obligacion): boolean {
  return (
    deuda.estado !== ObligacionEstadoEnum.ANULADA &&
    deuda.estado !== ObligacionEstadoEnum.PAGADA &&
    (aCentavos(deuda.saldo) ?? 0) > 0
  );
}

function nuevoMedio(id: number): LineaDeMedio {
  return { id, medio: MedioDeCobroMedioEnum.EFECTIVO, importe: '', referencia: '' };
}
