import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

import { ConsultoriosService } from '../../../../api/generated/api/consultorios.service';
import { OrganizacionesService } from '../../../../api/generated/api/organizaciones.service';
import { CreateConsultorioRequest } from '../../../../api/generated/model/create-consultorio-request';
import { OrganizationResponse } from '../../../../api/generated/model/organization-response';
import { SedesDelContexto } from '../../services/sedes-del-contexto';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CausaConsultorio, traducirErrorConsultorio } from '../../models/consultorio-errors';
import { crearEsperaPorLimite } from '../../../../shared/utils/espera-por-limite';
import { etiquetaDeZona, zonasHorarias } from '../../models/zonas-horarias';
import { nuevaClaveDeIntento } from '../../../../shared/utils/clave-de-intento';
import { numeroDeclarado } from '../../../../shared/utils/numero-declarado';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { validadorDeCuit } from '../../../../shared/utils/cuit';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { HorarioSemanal } from '../../../../shared/components/horario-semanal/horario-semanal';
import {
  SemanaDibujada,
  horarioRedactado,
} from '../../../../shared/components/horario-semanal/semana-dibujada';
import {
  crearFranjasForm,
  erroresDeFranjasDelServidor,
  franjasDelFormulario,
} from '../../../../shared/utils/franjas-semanales';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { MapaDeUbicacion } from '../../../../shared/components/mapa-de-ubicacion/mapa-de-ubicacion';
import { coordenadasFormateadas } from '../../../../shared/utils/enlaces-de-mapa';
import { EditorDeUbicacion } from '../../components/editor-de-ubicacion/editor-de-ubicacion';
import { direccionEnUnaLinea, tieneDireccion } from '../../models/direccion';
import {
  crearUbicacionForm,
  estadoDeUbicacion,
  origenParaElCable,
  ubicacionDelFormulario,
} from '../../models/ubicacion-form';

/** Estado del alta. Los cuatro casos exigen pantalla distinta (ADR-0005). */
type EstadoAlta =
  | { readonly tipo: 'editando' }
  | { readonly tipo: 'enviando' }
  | { readonly tipo: 'ok' }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly causa: CausaConsultorio };

/** Campos de cada paso, en el orden en que se enfoca el primero invalido tras un submit. */
const CAMPOS_PASO_1 = ['name', 'alias', 'slotMinutes', 'phone', 'contactEmail'] as const;
const CAMPOS_PASO_3 = ['boxCapacidad', 'taxId'] as const;

type Paso = 1 | 2 | 3 | 4;

const ULTIMO_PASO: Paso = 4;

/** Los cuatro pasos del alta, con lo que se carga en cada uno. */
const PASOS: readonly { readonly numero: Paso; readonly titulo: string; readonly sub: string }[] = [
  { numero: 1, titulo: 'Datos de la sede', sub: 'Nombre, agenda, contacto y visibilidad' },
  { numero: 2, titulo: 'Ubicación', sub: 'Dirección y punto en el mapa' },
  { numero: 3, titulo: 'Configuración inicial', sub: 'Opcional: horario, box y datos fiscales' },
  { numero: 4, titulo: 'Confirmación', sub: 'Revisar y crear' },
];

/** Duracion de turno que rige si no se cambia (la misma que el backend). */
const DURACION_POR_DEFECTO = 30;

/** Un telefono razonable: digitos con separadores habituales, al menos seis cifras. */
const PATRON_TELEFONO = /^\+?[\d\s().-]{6,}$/;

/**
 * Alta de una sede adicional, en tres pasos (M01, AKINE-02.01; refactor UX/UI del 28/10/2026;
 * ubicacion, contacto y datos fiscales heredados el 05/11/2026).
 *
 * <p>Consume `POST /organizations/{orgId}/consultorios`, que exige `consultorio:manage` con
 * alcance de <b>organizacion</b>: un administrador de una sola sede no puede crear otras, y
 * no hace falta ninguna regla especial aca para impedirlo —un alta no tiene sede objetivo,
 * asi que la interseccion con un alcance de una sola sede es vacia y el backend responde
 * `403`—.
 *
 * <p><b>Por que cuatro pasos y no un formulario largo.</b> Lo unico obligatorio es el nombre.
 * El paso 1 identifica la sede: nombre, agenda, contacto y visibilidad. El paso 2 dice donde
 * esta: direccion en partes y punto en el mapa ({@link EditorDeUbicacion}); va aparte porque
 * el mapa necesita el ancho entero y porque la ubicacion se completa muchas veces despues. El
 * paso 3 es configuracion OPCIONAL: horario de atencion, primer box y datos fiscales, que por
 * defecto son los de la organizacion. El paso 4 muestra todo lo que se va a crear antes de
 * crearlo.
 *
 * <h2>La clave de idempotencia</h2>
 *
 * <p>El header `Idempotency-Key` es obligatorio y <b>se genera una vez por intento</b>, no
 * por llamada: si el envio falla por un corte de red, el reintento va con la <b>misma</b>
 * clave y el backend devuelve la sede que ya habia creado en vez de crear una segunda. Eso
 * es lo que cierra el doble submit y el timeout, que es justamente el caso en el que el
 * cliente no sabe si el request llego.
 *
 * <p><b>Si el usuario cambia el cuerpo, la clave se renueva.</b> Reintentar la misma clave
 * con otro contenido es `409 idempotency-key-conflict`: para el backend eso ya no es un
 * reintento, es otra alta. Por eso el cuerpo enviado se guarda serializado y se compara en
 * cada envio (ver {@link claveParaElCuerpo}).
 *
 * <p><b>Un replay responde `201` con la misma sede, no `200`.</b> No hay forma —ni falta—
 * de distinguirlo desde aca: la pantalla muestra la sede que devolvio el backend, que es la
 * correcta en los dos casos. Lo que <b>no</b> hay que hacer es contar dos altas.
 *
 * <p><b>Reacciona a `contextEpoch`.</b> Un alta a medio llenar bajo la Organizacion A no
 * puede enviarse bajo la B, y su clave de intento tampoco: el formulario y el intento se
 * descartan enteros con el cambio de contexto.
 */
@Component({
  selector: 'app-new-consultorio-page',
  imports: [
    CabeceraDePagina,
    Ayuda,
    ReactiveFormsModule,
    RouterLink,
    HorarioSemanal,
    SemanaDibujada,
    Alerta,
    EditorDeUbicacion,
    MapaDeUbicacion,
  ],
  templateUrl: './new-consultorio-page.html',
  styleUrls: ['../../organization.css', './new-consultorio-page.css'],
})
export class NewConsultorioPage {
  private readonly consultorios = inject(ConsultoriosService);
  private readonly organizaciones = inject(OrganizacionesService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly sedes = inject(SedesDelContexto);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly pasos = PASOS;
  protected readonly ultimoPaso = ULTIMO_PASO;

  protected readonly zonas = zonasHorarias();
  protected readonly etiquetaDeZona = etiquetaDeZona;
  protected readonly espera = crearEsperaPorLimite();

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    name: ['', [textoRequerido]],
    alias: [''],
    // Vacio significa "heredar la de la organizacion": el contrato lo expresa OMITIENDO el
    // campo, no mandando una cadena vacia, que seria una zona invalida.
    timezone: [''],
    slotMinutes: [String(DURACION_POR_DEFECTO), [Validators.min(5), Validators.max(480)]],
    phone: ['', [Validators.pattern(PATRON_TELEFONO)]],
    contactEmail: ['', [Validators.email]],
    // Visibilidad (RF-M03-002): una sede puede existir sin recibir turnos todavia.
    agendaHabilitada: [true],
    direccionPublica: [true],
    // Datos fiscales: por defecto los de la organizacion; propios solo si se piden.
    datosFiscalesPropios: [false],
    legalName: [''],
    taxId: ['', [validadorDeCuit]],
    addressLine: [''],
    // Primer box (A-8, RF-M03-002). Vacio = la sede se crea sin box, como antes.
    boxNombre: [''],
    boxCapacidad: ['', [Validators.min(1)]],
  });

  /** Direccion en partes y punto en el mapa. Lo edita {@link EditorDeUbicacion}. */
  protected readonly ubicacion = crearUbicacionForm();

  /**
   * Horario general de la sede (A-8). Lista vacia = el campo se omite del alta. Fuera de
   * `formulario` porque el editor de franjas es de `shared/` y trabaja sobre su propio
   * `FormArray`.
   */
  protected readonly horario = crearFranjasForm();

  /** Errores de franja del ultimo `400`, por indice. Se limpian al editar el horario. */
  protected readonly erroresHorario = signal<ReadonlyMap<number, string>>(new Map());

  /** Error del primer box en el ultimo `400` (`primerBox.name`, `primerBox.capacidad`). */
  protected readonly errorPrimerBox = signal<string | null>(null);

  /** Error de un campo suelto en el ultimo `400` que no tiene lugar propio en pantalla. */
  protected readonly erroresDeCampo = signal<Readonly<Record<string, string>>>({});

  protected readonly paso = signal<Paso>(1);

  /** La organizacion, para mostrar los datos fiscales que la sede hereda. `null` hasta leerla. */
  protected readonly organizacion = signal<OrganizationResponse | null>(null);

  protected readonly estado = signal<EstadoAlta>({ tipo: 'editando' });
  protected readonly intentos = signal(0);

  /**
   * Clave del intento en curso y cuerpo con el que se genero.
   *
   * <p>Los dos juntos y no en signals separados: la clave sin el cuerpo que la origino no
   * sirve para decidir si un envio es un reintento o un alta distinta.
   */
  private readonly intento = signal<{ readonly clave: string; readonly cuerpo: string } | null>(
    null,
  );

  protected readonly enviando = computed(() => this.estado().tipo === 'enviando');
  protected readonly hecho = computed(() => this.estado().tipo === 'ok');

  protected readonly mensajeError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.mensaje : null;
  });

  protected readonly causaError = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? estado.causa : null;
  });

  /** El tope del plan no se resuelve reintentando: la salida es la pantalla de suscripcion. */
  protected readonly esTopeDelPlan = computed(() => this.causaError() === 'tope-del-plan');

  protected readonly bloqueado = computed(
    () => this.enviando() || this.hecho() || this.espera.activa(),
  );

  /** Datos fiscales de la organizacion, en renglones, para la herencia y el resumen. */
  protected readonly fiscalesDeLaOrganizacion = computed(() => {
    const organizacion = this.organizacion();
    if (organizacion === null) {
      return [];
    }
    return [
      ['Razón social', organizacion.legalName],
      ['CUIT', organizacion.taxId],
      ['Dirección fiscal', organizacion.fiscalAddressLine],
    ]
      .filter((par): par is [string, string] => !!par[1])
      .map(([rotulo, valor]) => `${rotulo}: ${valor}`);
  });

  /**
   * Resumen del paso 3: lo que se va a crear, para confirmar sin volver atras.
   *
   * <p>Metodo y no `computed`: lee el formulario, que no es un signal, y un `computed` sin
   * dependencias reactivas se calcula una vez y queda congelado. Volver al paso 1, cambiar el
   * nombre y avanzar mostraba el nombre viejo.
   */
  protected resumen() {
    const valores = this.formulario.getRawValue();
    const box = valores.boxNombre.trim();
    const capacidad = numeroDeclarado(valores.boxCapacidad);
    const ubicacion = ubicacionDelFormulario(this.ubicacion);
    const alias = valores.alias.trim();
    const contacto = [valores.phone.trim(), valores.contactEmail.trim()].filter((d) => d !== '');
    const fiscalesPropios = [
      ['Razón social', valores.legalName.trim()],
      ['CUIT', valores.taxId.trim()],
      ['Dirección fiscal', valores.addressLine.trim()],
    ]
      .filter(([, valor]) => valor !== '')
      .map(([rotulo, valor]) => `${rotulo}: ${valor}`);
    return {
      nombre: valores.name.trim(),
      alias: alias === '' ? null : alias,
      zona: valores.timezone === '' ? 'La misma que la organización' : valores.timezone,
      turno: `Turnos de ${numeroDeclarado(valores.slotMinutes) ?? DURACION_POR_DEFECTO} min`,
      contacto,
      direccion: direccionEnUnaLinea(ubicacion.direccion),
      referencias: ubicacion.direccion.referencias ?? '',
      coordenadas: ubicacion.coordenadas,
      coordenadasTexto:
        ubicacion.coordenadas === null
          ? ''
          : coordenadasFormateadas(ubicacion.coordenadas.latitud, ubicacion.coordenadas.longitud),
      estadoUbicacion: estadoDeUbicacion(ubicacion),
      agendaHabilitada: valores.agendaHabilitada,
      direccionPublica: valores.direccionPublica,
      box: box === '' ? null : `${box} (capacidad ${capacidad ?? 1})`,
      franjas: franjasDelFormulario(this.horario),
      horario: horarioRedactado(franjasDelFormulario(this.horario)),
      fiscalesPropios: valores.datosFiscalesPropios,
      fiscales: valores.datosFiscalesPropios ? fiscalesPropios : this.fiscalesDeLaOrganizacion(),
    };
  }

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.formulario.reset({
          name: '',
          alias: '',
          timezone: '',
          slotMinutes: String(DURACION_POR_DEFECTO),
          phone: '',
          contactEmail: '',
          agendaHabilitada: true,
          direccionPublica: true,
          datosFiscalesPropios: false,
          legalName: '',
          taxId: '',
          addressLine: '',
          boxNombre: '',
          boxCapacidad: '',
        });
        this.ubicacion.reset();
        this.horario.clear();
        this.erroresHorario.set(new Map());
        this.errorPrimerBox.set(null);
        this.erroresDeCampo.set({});
        this.paso.set(1);
        this.estado.set({ tipo: 'editando' });
        this.intentos.set(0);
        // La clave identifica un alta contra una organizacion concreta: reusarla despues de
        // cambiar de tenant no seria un reintento de nada.
        this.intento.set(null);
        this.organizacion.set(null);
        this.leerOrganizacion();
      });
    });

    // Un error del servidor describe el horario que se mando, no el que se esta editando.
    this.horario.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.erroresHorario().size > 0) {
        this.erroresHorario.set(new Map());
      }
    });
    this.formulario.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      if (Object.keys(this.erroresDeCampo()).length > 0) {
        this.erroresDeCampo.set({});
      }
    });
  }

  /** Los datos fiscales que la sede hereda. Si falla, el paso 2 lo dice y sigue sirviendo. */
  private leerOrganizacion(): void {
    const orgId = this.tenantContext.organizationId();
    if (orgId === null) {
      return;
    }
    this.organizaciones
      .getOrganization({ orgId })
      .pipe(
        catchError(() => of(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((organizacion) => this.organizacion.set(organizacion));
  }

  protected mostrarError(
    nombre: 'name' | 'alias' | 'slotMinutes' | 'phone' | 'contactEmail' | 'taxId' | 'boxCapacidad',
  ): boolean {
    const control = this.formulario.controls[nombre];
    const delServidor = this.erroresDeCampo()[nombre] !== undefined;
    return (control.invalid || delServidor) && (control.touched || this.intentos() > 0);
  }

  /** El mensaje de un campo: el del servidor si lo hay, si no el de la validacion local. */
  protected errorDe(
    nombre: 'name' | 'alias' | 'slotMinutes' | 'phone' | 'contactEmail' | 'taxId' | 'boxCapacidad',
    local: string,
  ): string {
    return this.erroresDeCampo()[nombre] ?? local;
  }

  /** Los botones - y + de la capacidad del box: nunca baja de 1. */
  protected cambiarCapacidad(delta: number): void {
    const control = this.formulario.controls.boxCapacidad;
    const actual = numeroDeclarado(control.value) ?? 1;
    control.setValue(String(Math.max(1, actual + delta)));
  }

  /** Valida el paso actual y pasa al siguiente. */
  protected avanzar(): void {
    this.intentos.update((valor) => valor + 1);
    const actual = this.paso();
    if (actual === ULTIMO_PASO || !this.pasoValido(actual)) {
      return;
    }
    this.irAPaso((actual + 1) as Paso);
  }

  protected volver(): void {
    const actual = this.paso();
    if (actual > 1) {
      this.irAPaso((actual - 1) as Paso);
    }
  }

  /** Cambia de paso y lleva el foco al titulo del paso nuevo: el lector anuncia donde quedo. */
  protected irAPaso(destino: Paso): void {
    this.paso.set(destino);
    this.intentos.set(0);
    if (this.estado().tipo === 'error') {
      this.estado.set({ tipo: 'editando' });
    }
    afterNextRender(() => this.enfocar('#titulo-alta-sede'), { injector: this.injector });
  }

  /** Si el paso tiene algo invalido, lo marca y enfoca el primer campo a corregir. */
  private pasoValido(paso: Paso): boolean {
    const campos = paso === 1 ? CAMPOS_PASO_1 : paso === 3 ? CAMPOS_PASO_3 : [];
    const invalido = campos.find((campo) => this.formulario.controls[campo].invalid);
    if (invalido !== undefined) {
      this.formulario.markAllAsTouched();
      afterNextRender(() => this.enfocar(`#sede-${invalido}`), { injector: this.injector });
      return false;
    }

    if (paso === 2 && this.ubicacion.invalid) {
      this.ubicacion.markAllAsTouched();
      afterNextRender(() => this.enfocar('#sede-ubicacion-latitud'), { injector: this.injector });
      return false;
    }

    if (paso === 3 && this.horario.invalid) {
      this.horario.markAllAsTouched();
      this.enfocar('#titulo-horario-general');
      return false;
    }
    return true;
  }

  /** El primer paso con algo invalido, o `null` si todo esta bien. */
  private primerPasoInvalido(): Paso | null {
    if (CAMPOS_PASO_1.some((campo) => this.formulario.controls[campo].invalid)) {
      return 1;
    }
    if (this.ubicacion.invalid) {
      return 2;
    }
    if (this.formulario.invalid || this.horario.invalid) {
      return 3;
    }
    return null;
  }

  protected enviar(): void {
    this.intentos.update((valor) => valor + 1);

    // Lo invalido se corrige en su paso: se vuelve ahi en vez de marcar campos que no se ven.
    const pasoInvalido = this.primerPasoInvalido();
    if (pasoInvalido !== null) {
      this.paso.set(pasoInvalido);
      this.pasoValido(pasoInvalido);
      return;
    }

    const orgId = this.tenantContext.organizationId();
    if (orgId === null || this.bloqueado()) {
      return;
    }

    const cuerpo = this.armarCuerpo();
    const clave = this.claveParaElCuerpo(cuerpo);

    this.estado.set({ tipo: 'enviando' });
    this.erroresHorario.set(new Map());
    this.errorPrimerBox.set(null);
    this.erroresDeCampo.set({});

    this.consultorios
      .createConsultorio({ orgId, idempotencyKey: clave, createConsultorioRequest: cuerpo })
      .subscribe({
        next: (sede) => {
          // Un reintento con la misma clave devuelve 201 con la MISMA sede: se muestra igual
          // que el alta original, sin contar un alta nueva ni avisar de un duplicado que no
          // existe. El intento se cierra aca.
          this.intento.set(null);
          this.sedes.invalidar();
          this.estado.set({ tipo: 'ok' });
          // UX-12: el alta es una pantalla propia; vuelve al listado y el resultado va al
          // aviso global, que sobrevive a la navegacion.
          this.avisos.exito('Sede creada', {
            descripcion: descripcionDelAlta(
              sede.name ?? cuerpo.name,
              cuerpo.primerBox !== undefined,
              (cuerpo.horarioGeneral?.length ?? 0) > 0,
              cuerpo.ubicacion !== undefined,
              cuerpo.agendaHabilitada !== false,
            ),
          });
          this.router.navigateByUrl('/organizacion/sedes').catch(() => undefined);
        },
        error: (error: unknown) => this.fallar(error),
      });
  }

  /**
   * La clave del intento en curso, o una nueva si el cuerpo cambio.
   *
   * <p>La comparacion es sobre el JSON que efectivamente se manda, no sobre el estado del
   * formulario: dos formularios distintos que producen el mismo cuerpo —por ejemplo, un
   * espacio de mas al final del nombre— son el mismo alta para el backend, y renovar la
   * clave ahi convertiria un reintento legitimo en una segunda sede.
   */
  private claveParaElCuerpo(cuerpo: CreateConsultorioRequest): string {
    const serializado = JSON.stringify(cuerpo);
    const enCurso = this.intento();

    if (enCurso !== null && enCurso.cuerpo === serializado) {
      return enCurso.clave;
    }

    const clave = nuevaClaveDeIntento();
    this.intento.set({ clave, cuerpo: serializado });
    return clave;
  }

  /**
   * Arma el cuerpo omitiendo lo que no se cargo.
   *
   * <p>Los opcionales vacios se <b>omiten</b> y no se mandan como cadena vacia: en el alta
   * una cadena vacia no significa "sin dato" sino un dato vacio, y en `timezone` seria
   * directamente una zona invalida que el backend rechaza con `400`. Los interruptores viajan
   * solo cuando se apartan de su valor por defecto, que es el que el backend asume.
   */
  private armarCuerpo(): CreateConsultorioRequest {
    const valores = this.formulario.getRawValue();
    const cuerpo: CreateConsultorioRequest = { name: valores.name.trim() };

    if (valores.timezone !== '') {
      cuerpo.timezone = valores.timezone;
    }

    // `numeroDeclarado` y no `valores.slotMinutes !== ''`: un `input type="number"` vaciado
    // entrega `null`, no `''`, y `Number(null)` es `0`. Un slot de 0 minutos viajaba como una
    // duracion deliberada.
    const slot = numeroDeclarado(valores.slotMinutes);
    if (slot !== null && slot !== DURACION_POR_DEFECTO) {
      cuerpo.slotMinutes = slot;
    }

    for (const campo of ['alias', 'phone', 'contactEmail'] as const) {
      const valor = valores[campo].trim();
      if (valor !== '') {
        cuerpo[campo] = valor;
      }
    }

    const ubicacion = ubicacionDelFormulario(this.ubicacion);
    if (tieneDireccion(ubicacion.direccion) || ubicacion.coordenadas !== null) {
      for (const parte of [
        'pais',
        'provincia',
        'ciudad',
        'calle',
        'numero',
        'codigoPostal',
        'piso',
        'referencias',
      ] as const) {
        const valor = ubicacion.direccion[parte] ?? '';
        if (valor !== '') {
          cuerpo[parte] = valor;
        }
      }
    }
    if (ubicacion.coordenadas !== null) {
      cuerpo.ubicacion = {
        latitud: ubicacion.coordenadas.latitud,
        longitud: ubicacion.coordenadas.longitud,
        origen: origenParaElCable(ubicacion.origen),
      };
    }

    if (!valores.agendaHabilitada) {
      cuerpo.agendaHabilitada = false;
    }
    if (!valores.direccionPublica) {
      cuerpo.direccionPublica = false;
    }

    if (valores.datosFiscalesPropios) {
      cuerpo.datosFiscalesPropios = true;
      for (const campo of ['legalName', 'taxId', 'addressLine'] as const) {
        const valor = valores[campo].trim();
        if (valor !== '') {
          cuerpo[campo] = valor;
        }
      }
    }

    // El box y el horario viajan solo si se cargaron: omitirlos da de alta la sede sola, y el
    // backend calcula el hash de idempotencia sin ellos, igual que antes de A-8.
    const box = valores.boxNombre.trim();
    if (box !== '') {
      const capacidad = numeroDeclarado(valores.boxCapacidad);
      cuerpo.primerBox = capacidad === null ? { name: box } : { name: box, capacidad };
    }

    if (this.horario.length > 0) {
      cuerpo.horarioGeneral = franjasDelFormulario(this.horario);
    }

    return cuerpo;
  }

  /**
   * Traduce el fallo. La clave del intento <b>sobrevive</b>, salvo que el backend la rechace.
   *
   * <p>Ese es todo el punto de la idempotencia: si el request se perdio en el camino, el
   * reintento tiene que ir con la misma clave para que el backend pueda reconocerlo. Tirarla
   * en el `catch` convertiria cada reintento en un alta nueva y produciria sedes duplicadas
   * justo en el caso que la clave existe para cubrir.
   *
   * <p>La unica excepcion es `409 idempotency-key-conflict`: ahi el backend dice que esa
   * clave ya quedo asociada a otro cuerpo, asi que reusarla vuelve a fallar para siempre. Se
   * descarta el intento y el proximo envio arranca uno nuevo.
   */
  private fallar(error: unknown): void {
    const traducido = traducirErrorConsultorio(error);

    if (traducido.causa === 'clave-repetida') {
      this.intento.set(null);
    }

    if (traducido.causa === 'limite') {
      this.espera.iniciar(traducido.segundosDeEspera);
    }

    let mensaje = traducido.mensaje;

    if (traducido.causa === 'validacion' && error instanceof AkineHttpError) {
      // El alta es atomica: un box o una franja invalidos rechazan todo con 400 y no queda
      // nada creado. Lo que falla se marca junto al campo, en el paso donde se corrige; un
      // cartel "la franja 3 es invalida" obligaria a contar filas.
      const campos = error.erroresPorCampo;
      const franjas = erroresDeFranjasDelServidor(campos);
      const box = Object.entries(campos).find(([campo]) => campo.startsWith('primerBox'));
      const sueltos = Object.fromEntries(
        Object.entries(campos).filter(
          ([campo]) => !campo.startsWith('horarioGeneral[') && !campo.startsWith('primerBox'),
        ),
      );
      this.erroresHorario.set(franjas);
      this.errorPrimerBox.set(box === undefined ? null : box[1]);
      this.erroresDeCampo.set(sueltos);
      const nombres = Object.keys(sueltos);
      if (franjas.size > 0 || box !== undefined || nombres.includes('taxId')) {
        this.paso.set(3);
      } else if (nombres.some((nombre) => nombre.startsWith('ubicacion'))) {
        this.paso.set(2);
      } else if (nombres.length > 0) {
        this.paso.set(1);
      }
      mensaje = error.mensajeSinCampos(() => true) ?? mensaje;
    }

    this.estado.set({ tipo: 'error', mensaje, causa: traducido.causa });
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/** Que quedo creado junto con la sede, para la descripcion del aviso de exito. */
function descripcionDelAlta(
  nombre: string,
  conBox: boolean,
  conHorario: boolean,
  conUbicacion: boolean,
  conAgenda: boolean,
): string {
  const box = conBox
    ? 'Se creo junto con su primer box.'
    : 'Todavía no tiene boxes: se agregan desde Espacios.';
  const horario = conHorario
    ? 'El horario general quedo cargado: ningún turno se ofrece fuera de ese horario.'
    : 'Sin horario general: se puede cargar desde el calendario de la sede.';
  const ubicacion = conUbicacion ? '' : ' La ubicación en el mapa queda pendiente.';
  const agenda = conAgenda
    ? ''
    : ' Todavía no recibe turnos: habilitá la agenda cuando esté lista.';
  return `${nombre}. ${box} ${horario}${ubicacion}${agenda}`;
}
