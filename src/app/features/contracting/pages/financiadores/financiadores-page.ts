import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { CreateFinanciadorRequest } from '../../../../api/generated/model/create-financiador-request';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { FinanciadorResponse } from '../../../../api/generated/model/financiador-response';
import { PERMISO_CONVENIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { UpdateFinanciadorRequest } from '../../../../api/generated/model/update-financiador-request';
import { ContractingApi, FiltroEstado, FiltroTipo } from '../../services/contracting-api';
import {
  CausaContracting,
  hayQueRecargar,
  traducirErrorContracting,
} from '../../models/contracting-errors';
import {
  NOTA_PARTICULAR,
  TIPOS_DE_FINANCIADOR,
  etiquetaDeTipo,
} from '../../models/etiquetas-de-contracting';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'editar' | 'baja';

/**
 * Catalogo de financiadores de la organizacion (M15, AKINE-03.03).
 *
 * <p>Es el <b>primer cimiento</b> de todo el circuito economico: sin financiador no hay plan, sin
 * plan no hay convenio y sin convenio no hay arancel. Todo lo que sigue en esta feature cuelga de
 * lo que se carga aca.
 *
 * <h2>1. El financiador es de la ORGANIZACION, y aun asi la pantalla exige una sede</h2>
 *
 * <p>Sus rutas no llevan `{consultorioId}` —el tenant sale del token— pero las mutaciones evaluan
 * `convenio:manage` <b>con la sede del contexto</b>. Sin sede elegida, el backend responde 403 a
 * cada boton y la pantalla no tendria como explicarlo. Por eso la ruta lleva `contextGuard`,
 * igual que el padron de personas, y por eso el listado se recarga entero cuando cambia el
 * contexto: un panel de baja a medio llenar apuntando a un financiador de otra organizacion es
 * exactamente la fuga de tenant que el aislamiento evita.
 *
 * <h2>2. El codigo es inmutable, y la edicion no lo incluye</h2>
 *
 * <p>No es una restriccion de formulario que se pueda relajar: el codigo es lo que las coberturas
 * y los convenios ya firmados <b>guardan</b>, asi que cambiarlo reescribiria el significado de
 * filas que no participan de esta llamada. El contrato ni siquiera lo acepta en el `PUT`. La
 * pantalla lo muestra deshabilitado con la explicacion al lado, en vez de esconderlo: quien
 * quiere corregir un codigo mal tipeado necesita entender que la salida es dar de baja y volver
 * a cargar, no buscar el campo en otra pestana.
 *
 * <h2>3. La baja NO cascadea, y decirlo es la mitad del trabajo de esta pantalla</h2>
 *
 * <p>"Dar de baja una obra social" suena a que todo lo suyo deja de valer, y es al reves: los
 * planes conservan sus filas, las coberturas y convenios ya firmados <b>siguen resolviendo</b>
 * (RN-M15-003), y lo unico que se impide es crear planes nuevos y ofrecerla en selecciones
 * nuevas. Tener planes activos tampoco bloquea la baja. El panel de confirmacion lo dice con
 * palabras antes de que el usuario apriete, no despues.
 *
 * <p><b>Y no hay reactivacion.</b> Un financiador que vuelve es un alta nueva. Como el codigo de
 * uno dado de baja se puede reusar, esa alta nueva puede llevar el mismo codigo — que es lo que
 * el mensaje del `409` explica cuando choca.
 *
 * <h2>4. `PARTICULAR` no esta en esta lista, a proposito</h2>
 *
 * <p>RN-M15-004. La nota de arriba de la tabla lo declara porque la ausencia, sin explicacion, se
 * lee como un dato que falta: alguien lo carga como una ficha mas, otro lo renombra o lo da de
 * baja, y con eso rompe el cobro particular de todo el centro.
 */
@Component({
  selector: 'app-financiadores-page',
  imports: [ReactiveFormsModule, RouterLink, PermisoDirective, ConfirmacionConMotivo],
  templateUrl: './financiadores-page.html',
  styleUrl: '../../contracting.css',
})
export class FinanciadoresPage {
  private readonly api = inject(ContractingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly permisoManage = PERMISO_CONVENIO_MANAGE;
  protected readonly tipos = TIPOS_DE_FINANCIADOR;
  protected readonly etiquetaDeTipo = etiquetaDeTipo;
  protected readonly notaParticular = NOTA_PARTICULAR;

  /**
   * Estado del listado. `GET /financiadores` <b>no pagina</b>: el contrato devuelve un array, asi
   * que el campo `pagina` de la union de ADR-0005 contiene todas las filas.
   */
  protected readonly estado = signal<EstadoDeListado<readonly FinanciadorResponse[]>>({
    tipo: 'cargando',
  });

  protected readonly financiadores = computed<readonly FinanciadorResponse[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.pagina : [];
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  protected readonly filtroEstado = signal<FiltroEstado>('ACTIVO');
  protected readonly filtroTipo = signal<FiltroTipo | null>(null);
  protected readonly busqueda = signal('');

  /** Fila y operacion abiertas, o `null`. Solo una a la vez. */
  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );

  /** `true` mientras el panel de alta esta abierto. El alta y la edicion se excluyen. */
  protected readonly altaAbierta = signal(false);

  /** Financiador tal como lo devolvio el backend, para el panel abierto. Base de comparacion. */
  private readonly original = signal<FinanciadorResponse | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaContracting | null>(null);
  protected readonly exito = signal<string | null>(null);
  protected readonly intentos = signal(0);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  /**
   * El texto del buscador, en un `FormGroup` y no en una referencia de plantilla.
   *
   * <p>Un `<form>` sin `[formGroup]` <b>no emite `ngSubmit`</b>: esa directiva es la que lo
   * dispara, y sin ella el binding queda escuchando un evento del DOM que nadie manda, asi que el
   * boton de buscar no hace absolutamente nada — sin error en consola ni en compilacion. Es el
   * mismo defecto que `ConfirmacionConMotivo` documenta en su javadoc, y ya se pago una vez.
   */
  protected readonly formularioBusqueda = this.formBuilder.nonNullable.group({ q: [''] });

  protected readonly formularioAlta = this.formBuilder.nonNullable.group({
    codigo: ['', [textoRequerido]],
    nombre: ['', [textoRequerido]],
    tipo: ['', [Validators.required]],
    cuit: [''],
    emailContacto: [''],
    telefonoContacto: [''],
    observaciones: [''],
  });

  /**
   * La edicion no tiene `codigo`, y no es un descuido: es inmutable. Ver el javadoc de la clase.
   */
  protected readonly formularioEdicion = this.formBuilder.nonNullable.group({
    nombre: ['', [textoRequerido]],
    tipo: ['', [Validators.required]],
    cuit: [''],
    emailContacto: [''],
    telefonoContacto: [''],
    observaciones: [''],
  });

  constructor() {
    effect(() => {
      // Dependencia explicita del contexto de trabajo: cambiar de organizacion o de sede invalida
      // todo lo que hay abierto y todo lo que hay listado.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });

    const texto = this.busqueda().trim();
    this.api
      .listarFinanciadores({
        q: texto === '' ? undefined : texto,
        estado: this.filtroEstado(),
        tipo: this.filtroTipo() ?? undefined,
      })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorContracting(respuesta, 'financiador');
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
          return;
        }
        this.estado.set({ tipo: 'listo', pagina: respuesta });
      });
  }

  /**
   * Busca por nombre, codigo o CUIT.
   *
   * <p>Se dispara con el <b>submit</b> del formulario de filtros y no en cada tecla. Una busqueda
   * en vivo necesita un debounce, y el debounce es de donde salio el defecto del buscador de
   * pacientes de la agenda: una peticion por letra, respuestas que llegan desordenadas, y el
   * listado mostrando el resultado de un texto que ya no esta escrito. Aca el volumen no lo
   * justifica — un centro tiene decenas de financiadores, no miles.
   *
   * <p>El texto va <b>sin normalizar</b>: normalizarlo aca duplicaria la regla que el backend ya
   * aplica —incluido el escapado de los comodines— y las dos copias se desincronizarian en la
   * primera correccion.
   */
  protected buscar(): void {
    this.cerrarPanel();
    this.busqueda.set(this.formularioBusqueda.getRawValue().q);
    this.cargar();
  }

  protected cambiarFiltroEstado(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'INACTIVO' || valor === 'TODOS' ? valor : ('ACTIVO' as const);
    this.cerrarPanel();
    this.filtroEstado.set(elegido);
    this.cargar();
  }

  protected cambiarFiltroTipo(valor: string): void {
    const conocido = this.tipos.some((opcion) => opcion.valor === valor);
    this.cerrarPanel();
    this.filtroTipo.set(conocido ? (valor as FiltroTipo) : null);
    this.cargar();
  }

  protected panelAbierto(id: number | undefined, tipo: TipoAccion): boolean {
    const panel = this.panel();
    return panel !== null && panel.id === id && panel.tipo === tipo;
  }

  protected abrirAlta(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.formularioAlta.reset({
      codigo: '',
      nombre: '',
      tipo: '',
      cuit: '',
      emailContacto: '',
      telefonoContacto: '',
      observaciones: '',
    });
    this.altaAbierta.set(true);
    afterNextRender(() => this.enfocar('#alta-financiador-codigo'), { injector: this.injector });
  }

  protected abrirPanel(financiador: FinanciadorResponse, tipo: TipoAccion): void {
    const id = financiador.id;
    if (id === undefined) {
      return;
    }

    this.cerrarPanel();
    this.exito.set(null);
    this.panel.set({ id, tipo });

    if (tipo === 'editar') {
      this.original.set(financiador);
      this.formularioEdicion.reset({
        nombre: financiador.nombre ?? '',
        tipo: financiador.tipo ?? '',
        cuit: financiador.cuit ?? '',
        emailContacto: financiador.emailContacto ?? '',
        telefonoContacto: financiador.telefonoContacto ?? '',
        observaciones: financiador.observaciones ?? '',
      });
      // El foco se va con el panel: sin esto, quien navega por teclado aprieta "Editar" y el
      // formulario aparece mas abajo mientras el foco sigue en el boton.
      afterNextRender(() => this.enfocar('#editar-financiador-nombre'), {
        injector: this.injector,
      });
    }
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.altaAbierta.set(false);
    this.original.set(null);
    this.enviando.set(false);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.intentos.set(0);
  }

  protected mostrarErrorAlta(campo: 'codigo' | 'nombre' | 'tipo'): boolean {
    const control = this.formularioAlta.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected mostrarErrorEdicion(campo: 'nombre' | 'tipo'): boolean {
    const control = this.formularioEdicion.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  /**
   * Da de alta un financiador.
   *
   * <p>Los opcionales vacios <b>no viajan</b>. En el alta daria casi lo mismo, pero se hace igual
   * por coherencia con la edicion, donde un `''` y un campo ausente significan cosas distintas.
   *
   * <p>El CUIT viaja tal como se escribio: el backend lo <b>normaliza a 11 digitos</b> antes de
   * guardar y de comparar, asi que `30-12345678-9` y `30123456789` chocan entre si. Limpiarlo aca
   * seria una segunda implementacion de esa regla, y es la leccion que 03.01 pago con el
   * documento de una persona.
   */
  protected enviarAlta(): void {
    if (this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);

    if (this.formularioAlta.invalid) {
      this.formularioAlta.markAllAsTouched();
      this.enfocar(
        this.formularioAlta.controls.codigo.invalid
          ? '#alta-financiador-codigo'
          : '#alta-financiador-nombre',
      );
      return;
    }

    const valores = this.formularioAlta.getRawValue();
    const cuerpo: CreateFinanciadorRequest = {
      codigo: valores.codigo.trim(),
      nombre: valores.nombre.trim(),
      tipo: valores.tipo as CreateFinanciadorRequest['tipo'],
    };

    agregarSiTiene(cuerpo, 'cuit', valores.cuit);
    agregarSiTiene(cuerpo, 'emailContacto', valores.emailContacto);
    agregarSiTiene(cuerpo, 'telefonoContacto', valores.telefonoContacto);
    agregarSiTiene(cuerpo, 'observaciones', valores.observaciones);

    this.empezarEnvio();

    this.api.crearFinanciador(cuerpo).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El financiador quedo dado de alta. Todavia no tiene planes: para poder firmar un ' +
            'convenio con el hace falta al menos uno, porque el convenio se firma contra un plan ' +
            'y no contra el financiador entero.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  protected enviarEdicion(): void {
    const panel = this.panel();
    if (panel === null || this.enviando()) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    if (this.formularioEdicion.invalid) {
      this.formularioEdicion.markAllAsTouched();
      this.enfocar('#editar-financiador-nombre');
      return;
    }

    const cambios = this.armarCambios();
    if (cambios === null) {
      return;
    }

    this.empezarEnvio();

    this.api.editarFinanciador(panel.id, cambios).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set('Los datos del financiador quedaron guardados.');
        this.cargar();
      },
      error: (error: unknown) => this.fallarEdicion(error),
    });
  }

  /**
   * Da de baja el financiador del panel abierto.
   *
   * <p>El mensaje de exito repite lo que el panel ya habia advertido: que <b>no cascadea</b>. Es
   * deliberado — quien acaba de dar de baja una obra social necesita saber, en ese momento, que
   * sus convenios siguen resolviendo; enterarse dos meses despues por una factura es la version
   * cara de la misma informacion.
   */
  protected enviarBaja(motivo: string): void {
    const panel = this.panel();
    if (panel === null || this.enviando()) {
      return;
    }

    this.empezarEnvio();

    this.api.darDeBajaFinanciador(panel.id, { reason: motivo }).subscribe({
      next: () => {
        this.cerrarPanel();
        this.exito.set(
          'El financiador quedo dado de baja. Sus planes conservan sus filas y las coberturas y ' +
            'convenios ya firmados siguen resolviendo: lo unico que se impide es crear planes ' +
            'nuevos bajo el y ofrecerlo en selecciones nuevas. No hay reactivacion, pero su codigo ' +
            'queda libre para un alta nueva.',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallar(error),
    });
  }

  /**
   * Arma el cuerpo de la edicion: lo que cambio y la `expectedVersion`.
   *
   * <p><b>Los campos que llegan en null no se tocan</b>, asi que solo viaja lo que efectivamente
   * cambio. No hay ninguna forma de <b>vaciar</b> un opcional —no existen los `limpiar*` que si
   * tiene la oferta— y por eso un campo que se deja en blanco no borra nada: se manda `''`, que
   * es un valor y no una ausencia. La pantalla lo dice en su texto de ayuda en vez de fingir que
   * se puede.
   *
   * <p>El `codigo` no esta: es inmutable y el contrato no lo acepta.
   */
  private armarCambios(): UpdateFinanciadorRequest | null {
    const original = this.original();
    const version = original?.version;
    if (original === null || version === undefined) {
      this.errorAccion.set(
        'No pudimos leer la version de este financiador. Cerra el panel, recarga el listado y ' +
          'volve a intentar.',
      );
      return null;
    }

    const valores = this.formularioEdicion.getRawValue();
    const cambios: UpdateFinanciadorRequest = { expectedVersion: version };

    const nombre = valores.nombre.trim();
    if (nombre !== (original.nombre ?? '')) {
      cambios.nombre = nombre;
    }
    if (valores.tipo !== (original.tipo ?? '')) {
      cambios.tipo = valores.tipo as UpdateFinanciadorRequest['tipo'];
    }

    const cuit = valores.cuit.trim();
    if (cuit !== (original.cuit ?? '')) {
      cambios.cuit = cuit;
    }
    const email = valores.emailContacto.trim();
    if (email !== (original.emailContacto ?? '')) {
      cambios.emailContacto = email;
    }
    const telefono = valores.telefonoContacto.trim();
    if (telefono !== (original.telefonoContacto ?? '')) {
      cambios.telefonoContacto = telefono;
    }
    const observaciones = valores.observaciones.trim();
    if (observaciones !== (original.observaciones ?? '')) {
      cambios.observaciones = observaciones;
    }

    return cambios;
  }

  /**
   * Falla de la edicion. El conflicto de concurrencia tiene tratamiento propio.
   *
   * <p>Ante `409 conflict` —que es el `type` que emite este modulo, <b>no</b>
   * `concurrent-modification`— no se pisa nada y no se cierra el panel: se relee el listado con
   * los mismos filtros, se toma esa lectura como base de comparacion nueva —con su `version`
   * nueva— y se deja en pantalla lo que el usuario habia escrito.
   */
  private fallarEdicion(error: unknown): void {
    const traducido = traducirErrorContracting(error, 'financiador');
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);

    if (traducido.causa !== 'concurrencia') {
      return;
    }

    const abierto = this.panel();
    if (abierto === null) {
      return;
    }

    const texto = this.busqueda().trim();
    this.api
      .listarFinanciadores({
        q: texto === '' ? undefined : texto,
        estado: this.filtroEstado(),
        tipo: this.filtroTipo() ?? undefined,
      })
      .pipe(catchError(() => of(null)))
      .subscribe((financiadores) => {
        if (financiadores === null) {
          return;
        }
        const releido = financiadores.find((ficha) => ficha.id === abierto.id);
        if (releido !== undefined) {
          this.original.set(releido);
        }
        this.estado.set({ tipo: 'listo', pagina: financiadores });
      });
  }

  private fallar(error: unknown): void {
    const traducido = traducirErrorContracting(error, 'financiador');
    this.enviando.set(false);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private empezarEnvio(): void {
    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);
  }

  /** Deja la pantalla como recien entrada: sin panel, sin filtros, sin busqueda. */
  private reiniciar(): void {
    this.cerrarPanel();
    this.exito.set(null);
    this.filtroEstado.set('ACTIVO');
    this.filtroTipo.set(null);
    this.busqueda.set('');
    this.formularioBusqueda.reset({ q: '' });
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}

/** Agrega el campo solo si tiene contenido, ya recortado. Los vacios no viajan. */
function agregarSiTiene<T extends object, K extends keyof T>(
  cuerpo: T,
  clave: K,
  valor: string,
): void {
  const limpio = valor.trim();
  if (limpio !== '') {
    cuerpo[clave] = limpio as T[K];
  }
}
