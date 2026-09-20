import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { HabilitacionesResponse } from '../../../../api/generated/model/habilitaciones-response';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { OfferingApi } from '../../services/offering-api';
import { CausaOffering, hayQueRecargar, traducirErrorOffering } from '../../models/offering-errors';

/** Una fila de casilla, igual para profesionales y para espacios. */
interface Candidato {
  readonly id: number;
  readonly etiqueta: string;
  readonly detalle: string;
  /** `true` si esta habilitado ahora mismo, o sea si la casilla arranca marcada. */
  readonly habilitado: boolean;
  /**
   * Advertencia sobre el recurso, o cadena vacia.
   *
   * <p>Un profesional cuyo vinculo se corto o un espacio dado de baja siguen apareciendo con su
   * habilitacion intacta. Se muestran con la advertencia y NO se esconden: esconderlos dejaria
   * al administrador sin entender por que la capacidad efectiva cambio sola.
   */
  readonly advertencia: string;
}

/**
 * Configurar quien presta una oferta y donde (M27/M04/M05, AKINE-02.07).
 *
 * <h2>Lo unico que hay que entender para leer esta pantalla</h2>
 *
 * <p><b>Ninguna casilla marcada NO significa "nadie".</b> Significa que la oferta no esta
 * restringida: cualquier profesional con vinculo vigente puede prestarla y puede prestarse en
 * cualquier espacio de la sede. La pantalla lo dice <b>con palabras</b> arriba de cada lista, en
 * vez de dejar que el usuario interprete una grilla vacia, porque las dos lecturas posibles son
 * exactamente opuestas.
 *
 * <p>El caso peligroso es el otro: quien desmarca la ultima casilla creyendo que restringe, abre
 * la oferta a todos. Por eso el aviso cambia en vivo mientras se editan las casillas, antes de
 * guardar.
 *
 * <h2>Se guarda la lista entera, no de a una</h2>
 *
 * <p>Un boton por seccion que manda el conjunto completo, con la {@code version} de la OFERTA. El
 * servidor hace el diff y devuelve la configuracion resultante, que es lo que la pantalla vuelve
 * a pintar. Mandar altas y bajas de a una obligaria a esta pantalla a diffear, y un diff mal
 * hecho produce bajas que nadie pidio.
 *
 * <h2>Capacidad efectiva</h2>
 *
 * <p>Se muestra al lado de la comercial <b>solo cuando difieren</b>, y siempre nombrando el
 * espacio que la limita. Un numero mas chico sin esa explicacion es un defecto: el administrador
 * no tiene forma de saber que habilitar una sala de seis bajo la capacidad de ocho que el habia
 * cargado.
 */
@Component({
  selector: 'app-habilitaciones-de-la-oferta-page',
  imports: [RouterLink, PermisoDirective],
  templateUrl: './habilitaciones-de-la-oferta-page.html',
  styleUrl: '../../offering.css',
})
export class HabilitacionesDeLaOfertaPage {
  private readonly api = inject(OfferingApi);
  private readonly contexto = inject(TenantContextStore);
  private readonly ruta = inject(ActivatedRoute);

  protected readonly PERMISO_CONSULTORIO_MANAGE = PERMISO_CONSULTORIO_MANAGE;

  protected readonly ofertaId = Number(this.ruta.snapshot.paramMap.get('ofertaId'));

  protected readonly estado = signal<EstadoDeListado<HabilitacionesResponse>>({ tipo: 'cargando' });
  protected readonly oferta = signal<OfertaResponse | null>(null);
  protected readonly guardando = signal(false);
  protected readonly exito = signal<string | null>(null);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaOffering | null>(null);

  /** Ids marcados AHORA en la pantalla, que puede diferir de lo guardado. */
  protected readonly profesionalesMarcados = signal<ReadonlySet<number>>(new Set());
  protected readonly espaciosMarcados = signal<ReadonlySet<number>>(new Set());

  protected readonly candidatosProfesional = signal<readonly Candidato[]>([]);

  /** Colaboradores y espacios de la sede, para poder ofrecer los que todavia no se habilitaron. */
  private readonly colaboradoresDeLaOrg = signal<
    readonly { id: number; nombre: string; rol: string }[]
  >([]);
  private readonly espaciosDeLaSede = signal<
    readonly { id: number; nombre: string; capacidad: number }[]
  >([]);
  private ultimaConfiguracion: HabilitacionesResponse | null = null;
  protected readonly candidatosEspacio = signal<readonly Candidato[]>([]);

  /**
   * Lo que la pantalla va a producir si se guarda AHORA.
   *
   * <p>Se calcula sobre las casillas y no sobre lo guardado, para que el aviso de "esto deja la
   * oferta sin restringir" aparezca ANTES de apretar guardar y no despues.
   */
  protected readonly quedaraSinRestringirProfesional = computed(
    () => this.profesionalesMarcados().size === 0,
  );
  protected readonly quedaraSinRestringirEspacio = computed(
    () => this.espaciosMarcados().size === 0,
  );

  /**
   * La configuracion cargada, o `null`.
   *
   * <p>Existe porque el `@switch` de la plantilla <b>no estrecha</b> la union de
   * {@link EstadoDeListado}: adentro de `@case('listo')` el compilador de plantillas sigue
   * viendo el tipo entero y `estado().pagina` no compila. Narrowear aca, donde TypeScript si
   * lo hace, es mas barato que repetir el chequeo en cada interpolacion.
   */
  protected readonly configuracion = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.pagina : null;
  });

  /** El mensaje del estado de error, o `null`. Mismo motivo que arriba. */
  protected readonly mensajeDeCarga = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  /**
   * La version de la oferta no se pudo leer, asi que no hay con que guardar.
   *
   * <p>Es estado de la pantalla y no una causa de error del backend: el fallo puede venir de la
   * carga inicial o del refresco posterior a un guardado que si entro, y en ese segundo caso no
   * hay ninguna operacion fallida a la que atribuirselo.
   */
  protected readonly ofertaIlegible = signal(false);

  protected readonly hayQueRecargar = computed(
    () => hayQueRecargar(this.causaAccion()) || this.ofertaIlegible(),
  );

  protected readonly faltaContexto = computed(() => this.contexto.consultorioId() === null);

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    const consultorioId = this.contexto.consultorioId();
    if (consultorioId === null) {
      // Sin sede elegida no hay nada que pedir: la oferta pertenece a una sede concreta. La
      // plantilla ofrece el selector de contexto, no el login: la sesion sigue abierta.
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.ofertaIlegible.set(false);

    this.api.verHabilitaciones(consultorioId, this.ofertaId).subscribe({
      next: (respuesta) => {
        this.estado.set({ tipo: 'listo', pagina: respuesta });
        this.sincronizarCasillas(respuesta);
      },
      error: (error: unknown) => {
        const traducido = traducirErrorOffering(error, 'oferta');
        // `faltaContexto` viaja en el estado porque la plantilla resuelve ese caso con un
        // enlace al selector de sede y no con un reintento: reintentar sin contexto vuelve a
        // fallar igual.
        this.estado.set({
          tipo: 'error',
          mensaje: traducido.mensaje,
          faltaContexto: traducido.causa === 'sin-contexto',
        });
      },
    });

    this.refrescarOferta(consultorioId);

    // Y los CANDIDATOS: sin esto la pantalla solo mostraria lo ya habilitado y no habria forma
    // de agregar a nadie. Un error aca no rompe la pantalla —la configuracion actual se sigue
    // viendo—, solo deja la lista mas corta.
    const organizationId = this.contexto.organizationId();
    if (organizationId !== null) {
      this.api.candidatosAHabilitar(organizationId).subscribe({
        next: (pagina) => {
          this.colaboradoresDeLaOrg.set(
            (pagina.content ?? [])
              .filter((fila) => fila.estado === 'ACTIVA')
              .map((fila) => ({
                id: fila.id ?? 0,
                nombre: fila.accountName ?? fila.accountEmail ?? `Colaborador #${fila.id}`,
                rol: fila.roleCode ?? '',
              })),
          );
          this.refusionar();
        },
        error: () => this.colaboradoresDeLaOrg.set([]),
      });

      this.api.espaciosDeLaSede(organizationId, consultorioId).subscribe({
        next: (pagina) => {
          this.espaciosDeLaSede.set(
            (pagina.content ?? []).map((fila) => ({
              id: fila.id ?? 0,
              nombre: fila.name ?? `Espacio #${fila.id}`,
              capacidad: fila.capacidad ?? 0,
            })),
          );
          this.refusionar();
        },
        error: () => this.espaciosDeLaSede.set([]),
      });
    }
  }

  protected alternarProfesional(id: number): void {
    this.profesionalesMarcados.update((actuales) => alternar(actuales, id));
  }

  protected alternarEspacio(id: number): void {
    this.espaciosMarcados.update((actuales) => alternar(actuales, id));
  }

  protected estaMarcadoProfesional(id: number): boolean {
    return this.profesionalesMarcados().has(id);
  }

  protected estaMarcadoEspacio(id: number): boolean {
    return this.espaciosMarcados().has(id);
  }

  protected guardarProfesionales(): void {
    this.guardar((consultorioId, version) =>
      this.api.fijarProfesionalesHabilitados(
        consultorioId,
        this.ofertaId,
        [...this.profesionalesMarcados()],
        version,
      ),
    );
  }

  protected guardarEspacios(): void {
    this.guardar((consultorioId, version) =>
      this.api.fijarEspaciosHabilitados(
        consultorioId,
        this.ofertaId,
        [...this.espaciosMarcados()],
        version,
      ),
    );
  }

  /**
   * Guarda y vuelve a pintar con lo que el servidor devolvio.
   *
   * <p>Se repinta con la respuesta y no con lo que la pantalla tenia: el servidor pudo haber
   * cerrado habilitaciones que esta pantalla no sabia que existian, y confiar en el estado local
   * dejaria la grilla mostrando algo que ya no es cierto.
   */
  private guardar(
    operacion: (
      consultorioId: number,
      version: number,
    ) => ReturnType<OfferingApi['fijarProfesionalesHabilitados']>,
  ): void {
    const consultorioId = this.contexto.consultorioId();
    const oferta = this.oferta();
    if (consultorioId === null || oferta === null) {
      // Ultima red: la plantilla ya apaga los botones, pero un submit por teclado o una carrera
      // entre el click y el fallo del refresco llegarian igual. Lo que no puede volver a pasar es
      // que el corte no produzca NINGUN sintoma.
      this.errorAccion.set(consultorioId === null ? MENSAJE_SIN_SEDE : MENSAJE_SIN_OFERTA);
      this.ofertaIlegible.set(consultorioId !== null);
      return;
    }

    this.guardando.set(true);
    this.exito.set(null);
    this.errorAccion.set(null);
    this.causaAccion.set(null);

    operacion(consultorioId, oferta.version ?? 0).subscribe({
      next: (respuesta) => {
        this.guardando.set(false);
        this.estado.set({ tipo: 'listo', pagina: respuesta });
        this.sincronizarCasillas(respuesta);
        this.exito.set('Guardamos la configuracion de la oferta.');

        // Guardar HACE AVANZAR la version de la oferta: el backend la carga con incremento
        // forzado, porque si no la version se queda quieta y el control optimista no serializa a
        // dos administradores. Como `HabilitacionesResponse` no trae esa version, hay que volver
        // a pedirla; sin esto, guardar profesionales y despues espacios da un 409 que le echa la
        // culpa a una edicion ajena que no existio.
        this.refrescarOferta(consultorioId);
      },
      error: (error: unknown) => {
        this.guardando.set(false);
        const traducido = traducirErrorOffering(error, 'oferta');
        this.errorAccion.set(traducido.mensaje);
        this.causaAccion.set(traducido.causa);
        if (traducido.causa === 'concurrencia') {
          // El 409 no piso nada. Se relee para que el usuario decida sobre los datos actuales, y
          // se recarga tambien la oferta porque lo que quedo viejo es SU version.
          this.cargar();
        }
      },
    });
  }

  /**
   * Vuelve a pedir la oferta, por su nombre comercial y sobre todo por su `version`.
   *
   * <p>Se pide aparte porque el endpoint de habilitaciones devuelve la configuracion y no la
   * oferta. Un fallo aca deja `oferta` en `null`, y sin version no se puede guardar: mandar una
   * version inventada pisaria la edicion de otro, que es exactamente lo que el control optimista
   * existe para impedir.
   *
   * <p><b>Cortar el guardado es correcto; cortarlo en silencio no.</b> Este fallo no tenia ni un
   * sintoma: la pantalla se dibujaba entera, con las casillas y los dos botones habilitados, y
   * apretar "Guardar" no producia nada —ni spinner, ni error, ni consola—. Peor todavia cuando
   * ocurria en el refresco POSTERIOR a un guardado exitoso: el cartel de exito del primero
   * quedaba en pantalla y el segundo boton quedaba muerto el resto de la sesion.
   *
   * <p>Por eso el fallo se declara al instante en {@link ofertaIlegible}: la plantilla apaga los
   * dos botones, explica por que y ofrece recargar, que es la unica salida real.
   */
  private refrescarOferta(consultorioId: number): void {
    this.api.listarOfertas(consultorioId, { estado: 'TODOS' }).subscribe({
      next: (ofertas) => {
        const encontrada = ofertas.find((candidata) => candidata.id === this.ofertaId) ?? null;
        this.oferta.set(encontrada);
        this.ofertaIlegible.set(encontrada === null);
        if (encontrada === null) {
          this.errorAccion.set(MENSAJE_SIN_OFERTA);
        }
      },
      error: () => {
        this.oferta.set(null);
        this.ofertaIlegible.set(true);
        this.errorAccion.set(MENSAJE_SIN_OFERTA);
      },
    });
  }

  /**
   * Pasa la respuesta del servidor a casillas, fusionando con los candidatos.
   *
   * <p><b>Las dos listas son la union</b> de lo habilitado y de lo que podria habilitarse: sin
   * los candidatos la pantalla solo mostraria lo ya configurado y no habria forma de agregar a
   * nadie. Lo habilitado manda cuando aparece en las dos, porque trae la advertencia y el estado.
   */
  private sincronizarCasillas(respuesta: HabilitacionesResponse): void {
    this.ultimaConfiguracion = respuesta;

    const profesionales = respuesta.profesionales ?? [];
    const espacios = respuesta.espacios ?? [];

    // Solo lo ACTIVO arranca marcado. Una habilitacion dada de baja se ve en la lista con su
    // motivo, pero su casilla no: volver a marcarla es una decision del usuario, no un default.
    this.profesionalesMarcados.set(
      new Set(profesionales.filter((f) => f.estado === 'ACTIVO').map((f) => f.membershipId ?? 0)),
    );
    this.espaciosMarcados.set(
      new Set(espacios.filter((f) => f.estado === 'ACTIVO').map((f) => f.espacioId ?? 0)),
    );

    this.refusionar();
  }

  /** Recalcula las dos listas visibles. Se llama al cargar y cuando llegan los candidatos. */
  private refusionar(): void {
    const respuesta = this.ultimaConfiguracion;
    if (respuesta === null) {
      return;
    }

    const habilitadosProfesional = new Map<number, Candidato>();
    for (const fila of respuesta.profesionales ?? []) {
      habilitadosProfesional.set(fila.membershipId ?? 0, {
        id: fila.membershipId ?? 0,
        etiqueta: fila.nombre ?? `Profesional #${fila.membershipId}`,
        detalle: fila.roleCode ?? '',
        habilitado: fila.estado === 'ACTIVO',
        advertencia: fila.vinculoVigente
          ? ''
          : 'Su vinculo con el centro ya no esta vigente: aunque figure habilitado, hoy no puede ' +
            'prestar la oferta.',
      });
    }

    const habilitadosEspacio = new Map<number, Candidato>();
    for (const fila of respuesta.espacios ?? []) {
      habilitadosEspacio.set(fila.espacioId ?? 0, {
        id: fila.espacioId ?? 0,
        etiqueta: fila.nombre ?? `Espacio #${fila.espacioId}`,
        detalle: `${fila.capacidad ?? 0} personas`,
        habilitado: fila.estado === 'ACTIVO',
        advertencia: fila.enServicio
          ? ''
          : 'Este espacio no esta en servicio: no acota la capacidad efectiva y no se puede usar ' +
            'hasta que vuelva.',
      });
    }

    this.candidatosProfesional.set(
      unir(
        habilitadosProfesional,
        this.colaboradoresDeLaOrg().map((persona) => ({
          id: persona.id,
          etiqueta: persona.nombre,
          detalle: persona.rol,
          habilitado: false,
          advertencia: '',
        })),
      ),
    );

    this.candidatosEspacio.set(
      unir(
        habilitadosEspacio,
        this.espaciosDeLaSede().map((espacio) => ({
          id: espacio.id,
          etiqueta: espacio.nombre,
          detalle: `${espacio.capacidad} personas`,
          habilitado: false,
          advertencia: '',
        })),
      ),
    );
  }
}

/**
 * El aviso de que no hay version con que guardar.
 *
 * <p>Nombra el dato que falta y la unica salida. Decir "ocurrio un error" dejaria al
 * administrador apretando un boton apagado sin saber que recargar lo destraba.
 */
const MENSAJE_SIN_OFERTA =
  'No pudimos leer la oferta, y sin su version no se puede guardar: mandar una version inventada ' +
  'pisaria la edicion de otra persona. Las casillas que marcaste NO se guardaron. Recarga la ' +
  'configuracion y volve a marcarlas.';

/** Sin sede elegida no hay oferta: el problema es el contexto, no la oferta. */
const MENSAJE_SIN_SEDE =
  'No hay una sede elegida, y la oferta pertenece a una. Elegi la sede y volve a entrar.';

/**
 * La union de lo habilitado y lo candidato, ordenada por etiqueta.
 *
 * <p>Lo habilitado gana cuando el mismo id esta en las dos: trae el estado y la advertencia, que
 * el candidato no conoce.
 */
function unir(
  habilitados: ReadonlyMap<number, Candidato>,
  candidatos: readonly Candidato[],
): readonly Candidato[] {
  const union = new Map(habilitados);
  for (const candidato of candidatos) {
    if (!union.has(candidato.id)) {
      union.set(candidato.id, candidato);
    }
  }
  return [...union.values()].sort((uno, otro) => uno.etiqueta.localeCompare(otro.etiqueta));
}

function alternar(actuales: ReadonlySet<number>, id: number): ReadonlySet<number> {
  const siguiente = new Set(actuales);
  if (siguiente.has(id)) {
    siguiente.delete(id);
  } else {
    siguiente.add(id);
  }
  return siguiente;
}
