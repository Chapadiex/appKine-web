import { Routes } from '@angular/router';

import { ANCHO_AMPLIO, DATA_ANCHO } from '../../core/models/ancho-de-contenido';
import { PERMISO_COBRO_REGISTER } from '../../core/models/permisos';
import { contextGuard } from '../../core/guards/context.guard';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * Rutas de la feature `billing` (cuenta corriente del paciente, M18, AKINE-07.01).
 *
 * <p>Se monta bajo `pacientes/:personaId/cuenta-corriente` desde `app.routes.ts` con
 * `loadChildren`, segun ADR-0004. <b>`authGuard` lo pone la ruta padre.</b>
 *
 * <h2>Por que cuelga del padron y no es una seccion del menu</h2>
 *
 * <p>Porque no se puede llegar sin una persona. La consulta es "que debe <i>fulano</i>", asi que
 * una entrada de menu tendria que abrir una pantalla vacia con un buscador de personas adentro —o
 * sea, el padron otra vez, duplicado—. El camino real es el que ya existe: se busca a la persona
 * en el padron y desde su fila se mira la cuenta. Por eso <b>no se agrego ninguna seccion a
 * `layout/navegacion-principal/secciones.ts`</b>.
 *
 * <p>La URL vive bajo `pacientes` y la feature no: `app.routes.ts` declara esta ruta <b>antes</b>
 * que la de `person`, que si no se quedaria con todo `pacientes/**`. Asi la direccion refleja el
 * camino del usuario sin que `person` tenga que importar nada de `billing` (AGENT.md 4.4).
 *
 * <h2>`contextGuard`, y sin `permissionGuard`</h2>
 *
 * <p>La consulta se arma con `/consultorios/{id}/obligaciones`: sin sede no hay ni URL que
 * construir, asi que mandar al selector una vez es preferible a abrir una pantalla que no puede
 * pedir nada. <b>La deuda sigue siendo de la organizacion</b> —eso no lo cambia el guard—; la sede
 * es de donde sale el tenant y contra donde se evalua el permiso.
 *
 * <p><b>No lleva `permissionGuard`</b> aunque el backend exija `cobro:register` para las dos
 * operaciones. El enlace que trae hasta aca ya va detras de `*akinePermiso`, que es donde la UX
 * tiene que resolverlo; un guard encima solo cambiaria un `403` explicado por una redireccion a
 * "sin permiso" para quien pegue la URL a mano. La autoridad es el backend, que rechaza igual.
 *
 * <p>Pide <b>ancho amplio</b>: la tabla tiene seis columnas de datos —tres de ellas de plata— mas
 * la de acciones, y a 46rem los importes quedan detras del scroll horizontal, que para quien tiene
 * que compararlos es lo mismo que no existir.
 *
 * <h2>AKINE-07.02 agrega dos rutas, y `cobrar` SI lleva `permissionGuard`</h2>
 *
 * <p>Las tres rutas evaluan el mismo codigo —`cobro:register` cubre ver deuda, anularla y cobrar—
 * pero no se protegen igual, y la diferencia no es un descuido:
 *
 * <ul>
 *   <li><b>Las dos lecturas van sin `permissionGuard`.</b> Es la decision de 07.01 y sigue valiendo:
 *       el enlace que trae hasta aca ya va detras de `*akinePermiso`, y un guard encima solo
 *       cambiaria un `403` explicado por una redireccion a "sin permiso" para quien pegue la URL a
 *       mano.</li>
 *   <li><b>`cobrar` lo lleva.</b> Es una pantalla cuyo unico proposito es una mutacion de dinero:
 *       sin el permiso no hay nada que leer ahi, solo un formulario que el operador puede llenar
 *       entero —elegir deudas, cargar medios, tipear importes— para recibir un `403` al confirmar.
 *       Ese es el caso que el guard evita, y por eso vale la redireccion.</li>
 * </ul>
 *
 * <p><b>Sigue sin ser seguridad.</b> La autoridad es el backend, que reevalua el permiso contra la
 * sede del contexto en cada request. Esto es UX: no ofrecer trabajo que va a terminar tirado.
 */
export const routes: Routes = [
  {
    path: '',
    canActivate: [contextGuard],
    loadComponent: () =>
      import('./pages/cuenta-corriente/cuenta-corriente-page').then((m) => m.CuentaCorrientePage),
    title: 'AKINE - Cuenta corriente',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },

  // Registro de un cobro (M19, AKINE-07.02).
  //
  // Ancho amplio: son tres bloques de formulario —deudas, medios y totales— y los importes se
  // leen comparando, igual que en la cuenta corriente.
  {
    path: 'cobrar',
    canActivate: [contextGuard, permissionGuard(PERMISO_COBRO_REGISTER)],
    loadComponent: () =>
      import('./pages/registro-de-cobro/registro-de-cobro-page').then((m) => m.RegistroDeCobroPage),
    title: 'AKINE - Registrar un cobro',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },

  // Cobros ya registrados y reimpresion del comprobante (M19, AKINE-07.02).
  {
    path: 'cobros',
    canActivate: [contextGuard],
    loadComponent: () => import('./pages/cobros/cobros-page').then((m) => m.CobrosPage),
    title: 'AKINE - Cobros registrados',
    data: { [DATA_ANCHO]: ANCHO_AMPLIO },
  },
];
