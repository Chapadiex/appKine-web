import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { HitoResponse } from '../../../../api/generated/model/hito-response';
import { PERMISO_COBRO_REGISTER, PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PersonApi } from '../../services/person-api';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { ResumenDePersonaResponse } from '../../../../api/generated/model/resumen-de-persona-response';
import { SeccionResponse } from '../../../../api/generated/model/seccion-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { CausaPersona, hayQueRecargar, traducirErrorPersona } from '../../models/person-errors';
import {
  documentoEnUnaLinea,
  nombreCompleto,
  perfilEnPalabras,
  personaInactiva,
} from '../../models/etiquetas-de-person';
import {
  etiquetaDeIndicador,
  fechaEnPalabras,
  hitoEnPalabras,
  nombreDeCategoria,
  nombreDeSeccion,
  omisionEnPalabras,
  valorDeIndicador,
} from '../../models/etiquetas-de-ficha';

/** Confirmacion abierta sobre la ficha. Solo una a la vez. */
type TipoDeBaja = 'persona' | 'perfil';

/** Una categoria de adjunto con cuantos documentos hay, ya ordenada para mostrar. */
interface ConteoPorCategoria {
  readonly categoria: string;
  readonly cantidad: number;
}

/**
 * La ficha 360 de una persona (RF-M07-004, M07/M25, AKINE-03.02).
 *
 * <p>Es la pantalla a la que se llega desde el padron cuando la pregunta deja de ser "quien es" y
 * pasa a ser "que pasa con esta persona": que turnos tiene, que debe, que documentacion presento y
 * a que otras pantallas se sigue.
 *
 * <h2>1. Una seccion vacia y una seccion prohibida no se ven igual, y esa es la pantalla</h2>
 *
 * <p>El backend <b>recorta por permisos y no rechaza</b>: la seccion cuyo permiso el actor no tiene
 * <b>no se pide</b>, y viaja en `seccionesOmitidas` con el codigo que falta. Devolver 403 sobre la
 * ficha entera por no poder ver la deuda dejaria al profesional sin poder abrir a ningun paciente;
 * omitirla en silencio seria peor, porque la pantalla leeria "sin turnos" donde en realidad dice
 * "no podes ver los turnos".
 *
 * <p>Por eso las omitidas se renderizan como <b>secciones de primera clase</b>, con su titulo y su
 * explicacion, mezcladas visualmente con las que si vinieron. Ponerlas en una nota al pie las
 * convertiria en letra chica, y el hueco que producen es exactamente el que el usuario no puede
 * detectar por su cuenta.
 *
 * <h2>2. Aca no hay nada clinico, y no es que falte</h2>
 *
 * <p>AKINE-04.01 fijo que todo acceso clinico exige justificacion declarada y queda auditado. Una
 * ficha de mostrador que muestre casos al abrirla convertiria ese control en un formalismo. La
 * pantalla lo dice explicitamente en vez de dejar la ausencia como una duda: sin el cartel, quien
 * atiende busca la historia clinica en esta pantalla y concluye que el sistema no la tiene.
 *
 * <h2>3. Las dos bajas son distintas y no se encadenan</h2>
 *
 * <ul>
 *   <li><b>Dar de baja la persona</b> cierra la ficha <b>y su perfil de paciente</b> en la misma
 *       transaccion del backend. El estado "persona cerrada, paciente vigente" no existe, asi que
 *       la pantalla no ofrece hacer las dos cosas en orden: ofrecerlo sugeriria que hay un caso en
 *       el que hace falta.</li>
 *   <li><b>Dar de baja el perfil</b> deja a la persona vigente. Es el caso de RN-M07-006: alguien
 *       que sigue viniendo a actividades no clinicas y ya no es paciente.</li>
 * </ul>
 *
 * <p>Las dos exigen motivo, y las dos usan {@link ConfirmacionConMotivo} <b>con su default</b>
 * —`motivoObligatorio` vale `true`—: la operacion que restringe es la que alguien va a tener que
 * justificar despues. Es al reves que activar el perfil, donde el motivo es opcional y el panel
 * tiene que pasar `false` explicito.
 *
 * <p><b>Ninguna baja borra nada.</b> Los turnos siguen existiendo, las obligaciones se siguen
 * debiendo, los adjuntos se siguen descargando y la historia clinica —si la habia— no se toca. La
 * pantalla lo dice en la confirmacion, porque "dar de baja" en cualquier otro sistema significa
 * otra cosa.
 *
 * <h2>4. El caso que rompe la pantalla</h2>
 *
 * <p>Cambiar de organizacion con la ficha abierta. La persona pertenece a la <b>organizacion</b>:
 * bajo otra, ese id o no existe o es de otra persona. El `effect` de contexto cierra los paneles y
 * recarga, y la lectura responde 404 —que es el 403 disfrazado a proposito, para que probar ids no
 * mida el padron ajeno—. Lo que la pantalla no hace es quedarse mostrando el nombre viejo.
 */
@Component({
  selector: 'app-ficha-de-persona-page',
  imports: [RouterLink, ConfirmacionConMotivo, PermisoDirective],
  templateUrl: './ficha-de-persona-page.html',
  styleUrl: '../../person.css',
})
export class FichaDePersonaPage {
  private readonly api = inject(PersonApi);
  private readonly tenantContext = inject(TenantContextStore);

  /** De la ruta. `withComponentInputBinding` lo liga solo. */
  readonly personaId = input.required<string>();

  protected readonly permisoManage = PERMISO_PACIENTE_MANAGE;
  protected readonly permisoCobro = PERMISO_COBRO_REGISTER;

  protected readonly documentoEnUnaLinea = documentoEnUnaLinea;
  protected readonly nombreCompleto = nombreCompleto;
  protected readonly perfilEnPalabras = perfilEnPalabras;
  protected readonly personaInactiva = personaInactiva;
  protected readonly nombreDeSeccion = nombreDeSeccion;
  protected readonly omisionEnPalabras = omisionEnPalabras;
  protected readonly etiquetaDeIndicador = etiquetaDeIndicador;
  protected readonly valorDeIndicador = valorDeIndicador;
  protected readonly hitoEnPalabras = hitoEnPalabras;
  protected readonly nombreDeCategoria = nombreDeCategoria;
  protected readonly fechaEnPalabras = fechaEnPalabras;

  protected readonly resumen = signal<ResumenDePersonaResponse | null>(null);
  protected readonly cargando = signal(true);
  protected readonly errorDeCarga = signal<string | null>(null);
  protected readonly faltaContexto = signal(false);

  protected readonly baja = signal<TipoDeBaja | null>(null);
  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaPersona | null>(null);
  protected readonly exito = signal<string | null>(null);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  protected readonly persona = computed<PersonaResponse | null>(
    () => this.resumen()?.persona ?? null,
  );

  protected readonly secciones = computed<readonly SeccionResponse[]>(
    () => this.resumen()?.secciones ?? [],
  );

  protected readonly omitidas = computed(() => this.resumen()?.seccionesOmitidas ?? []);

  protected readonly totalDeAdjuntos = computed(() => this.resumen()?.adjuntosTotal ?? 0);

  /**
   * El recuento de adjuntos por categoria, como lista y ordenado.
   *
   * <p>El contrato lo entrega como mapa, y un mapa no tiene orden garantizado: renderizarlo tal
   * cual haria que las categorias bailen entre dos cargas de la misma ficha. Se ordena por nombre
   * de categoria, que es estable y no depende de cuantos documentos haya.
   */
  protected readonly adjuntosPorCategoria = computed<readonly ConteoPorCategoria[]>(() => {
    const mapa = this.resumen()?.adjuntosPorCategoria ?? {};
    return Object.entries(mapa)
      .map(([categoria, cantidad]) => ({ categoria, cantidad }))
      .sort((a, b) => a.categoria.localeCompare(b.categoria));
  });

  /** Rutas hermanas, absolutas: un `..` depende de donde este montada la pantalla. */
  protected readonly rutaDocumentos = computed(
    () => `/pacientes/${this.personaId()}/documentos` as const,
  );
  protected readonly rutaCoberturas = computed(
    () => `/pacientes/${this.personaId()}/coberturas` as const,
  );
  protected readonly rutaAutorizaciones = computed(
    () => `/pacientes/${this.personaId()}/autorizaciones` as const,
  );
  protected readonly rutaCuentaCorriente = computed(
    () => `/pacientes/${this.personaId()}/cuenta-corriente` as const,
  );

  constructor() {
    effect(() => {
      // Las dos dependencias son explicitas: la persona de la URL y el contexto de trabajo.
      // Cambiar de organizacion con la ficha abierta tiene que recargar, no dejar el nombre viejo
      // en pantalla mientras el id ya significa otra cosa.
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.cerrarPaneles();
        this.cargar();
      });
    });
  }

  protected cargar(): void {
    const id = this.identificador();
    if (id === null) {
      // Un `personaId` que no es un numero solo llega por una URL escrita a mano. No se manda la
      // peticion: el backend responderia 400 y el mensaje hablaria de un parametro, no de lo que
      // el usuario hizo.
      this.cargando.set(false);
      this.errorDeCarga.set('La direccion no identifica a ninguna persona del padron.');
      return;
    }

    this.cargando.set(true);
    this.errorDeCarga.set(null);
    this.faltaContexto.set(false);

    this.api.resumen(id).subscribe({
      next: (resumen) => {
        this.resumen.set(resumen);
        this.cargando.set(false);
      },
      error: (error: unknown) => {
        const traducido = traducirErrorPersona(error);
        this.cargando.set(false);
        this.errorDeCarga.set(traducido.mensaje);
        this.faltaContexto.set(traducido.causa === 'sin-contexto');
      },
    });
  }

  // -------------------------------------------------------------------------------------
  // Bajas
  // -------------------------------------------------------------------------------------

  protected abrirBaja(tipo: TipoDeBaja): void {
    this.limpiarAvisos();
    this.baja.set(tipo);
  }

  protected confirmarBajaDePersona(motivo: string): void {
    const persona = this.persona();
    const id = this.identificador();
    if (persona === null || id === null) {
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    // La version es obligatoria en el contrato y opcional en el generado. Ausente se manda 0, que
    // produce el 409 de concurrencia en vez de pisar el cambio ajeno en silencio: mismo criterio
    // que la edicion del padron.
    this.api.darDeBaja(id, motivo, persona.version ?? 0).subscribe({
      next: (actualizada) => {
        this.terminar(
          `${nombreCompleto(actualizada)} quedo dada de baja del padron. No se borro nada: sus ` +
            'turnos, sus deudas y sus documentos se siguen consultando.',
        );
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  protected confirmarBajaDePerfil(motivo: string): void {
    const id = this.identificador();
    if (id === null) {
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.darDeBajaPerfil(id, motivo).subscribe({
      next: (actualizada) => {
        this.terminar(
          `${nombreCompleto(actualizada)} ya no tiene perfil de paciente. Su ficha sigue vigente: ` +
            'puede seguir participando de actividades no clinicas.',
        );
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  protected cerrarPaneles(): void {
    this.baja.set(null);
    this.limpiarAvisos();
  }

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  /** Hitos de una seccion. Vacio cuando la seccion vino sin ninguno, que es un caso normal. */
  protected hitosDe(seccion: SeccionResponse): readonly HitoResponse[] {
    return seccion.hitos ?? [];
  }

  /**
   * El `personaId` de la URL como numero, o `null`.
   *
   * <p>Se valida en vez de confiar: la URL la escribe cualquiera, y un `Number('abc')` da `NaN`
   * que despues viaja como `/personas/NaN`.
   */
  private identificador(): number | null {
    const crudo = Number(this.personaId());
    return Number.isInteger(crudo) && crudo > 0 ? crudo : null;
  }

  private terminar(mensaje: string): void {
    this.enviando.set(false);
    this.baja.set(null);
    this.exito.set(mensaje);
    // La ficha se relee entera y no se parchea con la respuesta: la baja de la persona tambien
    // cierra su perfil, y las secciones que aportan otros modulos pueden haber cambiado.
    this.cargar();
  }

  private fallo(error: unknown): void {
    this.enviando.set(false);
    const traducido = traducirErrorPersona(error);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private limpiarAvisos(): void {
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);
  }
}
