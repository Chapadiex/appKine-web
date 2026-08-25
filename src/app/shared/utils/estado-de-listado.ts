import { Signal, computed } from '@angular/core';

/**
 * Forma minima de una pagina devuelta por el backend.
 *
 * <p><b>No es un DTO manual.</b> AGENT.md 5 prohibe reescribir a mano los tipos del contrato,
 * y con razon: una copia de `MembershipResponse` se desincroniza en silencio. Esto es otra
 * cosa: una <b>restriccion estructural</b> sobre los tipos generados, que nunca viaja por la
 * red y que ningun servicio usa para serializar. Cada pagina del contrato -de colaboradores,
 * de sedes, de hechos auditados- la satisface tal cual viene del generador; si un dia el
 * contrato renombrara `totalPages`, esto deja de compilar, que es exactamente lo que se
 * quiere.
 *
 * <p>Los tres campos son opcionales porque asi los declara el contrato.
 */
export interface PaginaDelBackend<T> {
  readonly content?: readonly T[];
  readonly totalPages?: number;
  readonly totalElements?: number;
}

/**
 * En cual de los cinco estados esta un listado paginado.
 *
 * <p>Los cinco casos son pantallas distintas y no banderas combinables (ADR-0005): una lista
 * vacia no es un error, un error no es "todavia cargando", y ninguno de los dos es "no
 * elegiste contexto". Modelarlos como una union discriminada es lo que impide construir el
 * estado imposible -`cargando: true` con `error` puesto- que despues se ve en pantalla como
 * un spinner encima de un cartel rojo.
 *
 * <p>Las tres pantallas que estrenan este tipo -sedes, colaboradores y auditoria- lo
 * declaraban cada una por su cuenta, identico, con sus cinco `computed` derivados repetidos.
 *
 * <p><b>Que NO esta aca: la carga.</b> Quien dispara la peticion y traduce el error se queda
 * en cada pantalla, porque cada una llama a su propio traductor y esos traductores ramifican
 * por causas distintas -el de sedes conoce el tope del plan y el conflicto de concurrencia; el
 * de colaboradores, no-. Fusionarlos seria el mismo error que ya se evito al no fusionar el
 * mapeo de errores de `organization` con el de `auth`.
 */
export type EstadoDeListado<P> =
  /**
   * Todavia no se pidio nada, y no es un error.
   *
   * <p>Para los listados cuya consulta necesita que el usuario elija algo primero: sin ese
   * dato la peticion seria invalida, asi que cargar al entrar es un rechazo garantizado en
   * cada visita. Una pantalla que siempre puede cargar simplemente nunca usa este caso.
   */
  | { readonly tipo: 'inicial' }
  /** No hay Organizacion activa: la salida es elegir contexto, no reintentar. */
  | { readonly tipo: 'sin-contexto' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'listo'; readonly pagina: P }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly faltaContexto: boolean };

/** Lo que una plantilla de listado necesita leer, ya derivado del estado. */
export interface VistaDeListado<T> {
  /** Filas de la pagina actual. Vacio en cualquier estado que no sea `listo`. */
  readonly filas: Signal<readonly T[]>;
  readonly totalPaginas: Signal<number>;
  /** Total de elementos de TODAS las paginas, no de la actual. */
  readonly totalElementos: Signal<number>;
  /** Mensaje del backend, o `null` si el estado no es de error. */
  readonly mensajeError: Signal<string | null>;
  /** `true` cuando el error se resuelve eligiendo contexto y no reintentando. */
  readonly faltaContexto: Signal<boolean>;
}

/**
 * Deriva de un estado de listado los cinco valores que su plantilla lee.
 *
 * <p>Los cinco son `computed`, asi que se recalculan solos cuando el estado cambia y no
 * hacen falta suscripciones ni copias en campos: es lo que el modo zoneless espera.
 *
 * <p>Todos degradan a vacio -`[]`, `0`, `null`, `false`- fuera del estado que les da sentido.
 * Es deliberado: una plantilla que pregunta por `totalPaginas()` mientras carga tiene que
 * recibir `0` y no explotar por leer `pagina` en un estado que no la tiene.
 */
export function vistaDeListado<T>(
  estado: Signal<EstadoDeListado<PaginaDelBackend<T>>>,
): VistaDeListado<T> {
  return {
    filas: computed(() => {
      const actual = estado();
      return actual.tipo === 'listo' ? (actual.pagina.content ?? []) : [];
    }),
    totalPaginas: computed(() => {
      const actual = estado();
      return actual.tipo === 'listo' ? (actual.pagina.totalPages ?? 0) : 0;
    }),
    totalElementos: computed(() => {
      const actual = estado();
      return actual.tipo === 'listo' ? (actual.pagina.totalElements ?? 0) : 0;
    }),
    mensajeError: computed(() => {
      const actual = estado();
      return actual.tipo === 'error' ? actual.mensaje : null;
    }),
    faltaContexto: computed(() => {
      const actual = estado();
      return actual.tipo === 'error' && actual.faltaContexto;
    }),
  };
}
