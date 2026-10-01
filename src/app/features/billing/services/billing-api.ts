import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Cobro } from '../../../api/generated/model/cobro';
import { CobrosService } from '../../../api/generated/api/cobros.service';
import { Obligacion } from '../../../api/generated/model/obligacion';
import { ObligacionesService } from '../../../api/generated/api/obligaciones.service';
import { PersonaResponse } from '../../../api/generated/model/persona-response';
import { PersonasService } from '../../../api/generated/api/personas.service';
import { RegistrarCobro } from '../../../api/generated/model/registrar-cobro';

/**
 * Unico punto de la feature `billing` que toca el cliente generado (M18, AKINE-07.01).
 *
 * <p>Mismo criterio que `ClinicalApi` y `PersonApi`: la pantalla depende de esta clase y de los
 * tipos del contrato, nunca del servicio generado directo.
 *
 * <h2>La deuda es de la ORGANIZACION, aunque la URL lleve una sede</h2>
 *
 * <p>`consultorioId` viaja porque es de donde el backend saca el tenant y contra donde evalua
 * `cobro:register`, <b>no</b> porque filtre. Lo que vuelve es la deuda del paciente en todo el
 * centro: una persona que se atendio en dos sedes tiene una sola cuenta corriente, y partirla
 * obligaria al administrativo a sumar de memoria. La pantalla no puede presentarla como "la deuda
 * de esta sede" — seria falso.
 *
 * <h2>Obligacion, Cobro y Caja siguen siendo tres cosas (regla maestra 5)</h2>
 *
 * <p>Desde AKINE-07.02 esta fachada cubre las dos primeras, y <b>los metodos no se mezclan</b>:
 * `deLaPersona` devuelve deuda y `cobrosDeLaPersona` devuelve dinero recibido. No hay ningun
 * metodo que devuelva "el estado de cuenta" fusionando las dos, porque no es una fusion: una
 * deuda y un cobro no son el mismo hecho ni se anulan entre si en una lista.
 *
 * <p><b>La Caja no esta y no puede estarla.</b> Es M20 / AKINE-07.03. Sin ella tampoco hay
 * anticipos ni anulacion de cobro: un anticipo sin caja es plata que entro y que ningun arqueo
 * puede encontrar, y un reintegro saca dinero de una caja que no existe. El contrato no publica
 * esos endpoints y esta clase no los inventa.
 *
 * <h2>Lo que esta fachada NO tiene</h2>
 *
 * <p><b>No hay crear una obligacion.</b> No es una omision: la deuda se <b>deriva</b> del
 * cierre de la sesion, del lado del backend, y no se carga a mano. Un metodo de alta aca abriria
 * la puerta a una cuenta corriente sin prestacion que la justifique.
 *
 * <p>Y no hay devolucion: cuando la deuda ya tiene cobros imputados lo que corresponde es una
 * devolucion, que es M19 y tiene su propio registro. Fuera de alcance por DP-10.
 */
@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly api = inject(ObligacionesService);
  private readonly cobros = inject(CobrosService);
  private readonly personas = inject(PersonasService);

  /**
   * De quien es esta cuenta corriente.
   *
   * <p><b>Por que la lee `billing` y no la pide prestada al padron.</b> Un feature no importa de
   * otro (AGENT.md 4.4), asi que inyectar `PersonApi` estaria mal; lo que se consume aca es el
   * cliente generado, que es lo que la regla manda. Y hace falta de verdad: anular una deuda es
   * irreversible y la pantalla tiene que decir a nombre de quien, no un numero de la URL.
   *
   * <p>El fallo de esta lectura <b>no</b> voltea la pantalla: la cuenta corriente se muestra igual
   * con el encabezado generico. Perder la deuda entera porque no cargo un apellido seria peor.
   */
  verPersona(personaId: number): Observable<PersonaResponse> {
    return this.personas.verPersona({ personaId });
  }

  /**
   * La cuenta corriente del paciente, de la mas reciente a la mas vieja.
   *
   * <p>Hasta el contrato 0.21.0 este metodo se llamaba `deLaPersona1`, con un `1` que no era un
   * typo: `GET /obligaciones` y `GET /cobros` declaraban el <b>mismo</b> `operationId` y el
   * generador desambiguaba sufijando el segundo. El numero se asignaba por orden de aparicion, asi
   * que agregar o renombrar cualquier operacion homonima se lo pasaba a otra y esta linea dejaba de
   * compilar en un archivo que nadie habia tocado.
   *
   * <p>Corregido en el backend en 0.22.0 —`operationId` unicos, con un gate del contrato que falla
   * si alguno vuelve a venir sufijado—. Queda anotado porque explica por que estos nombres son
   * largos: `obligacionesDeLaPersona` y no `deLaPersona` es lo que los mantiene unicos.
   */
  deLaPersona(consultorioId: number, personaId: number): Observable<readonly Obligacion[]> {
    return this.api.obligacionesDeLaPersona({ consultorioId, personaId });
  }

  /**
   * Anula una deuda con motivo obligatorio.
   *
   * <p><b>No la borra.</b> Una deuda que desaparece de la base es una cuenta corriente que no
   * cuadra y que nadie puede auditar despues, y por eso el motivo no es opcional aca aunque otras
   * bajas del sistema lo dejen vacio.
   *
   * <p>`version` es la que se leyo: sin ella dos administrativos mirando la misma pantalla se
   * pisan en silencio. La respuesta trae la obligacion anulada —con su estado y su version nueva—
   * y no un 204, justamente para que la pantalla pueda seguir operando sin releer.
   */
  anular(
    consultorioId: number,
    obligacionId: number,
    motivo: string,
    version: number,
  ): Observable<Obligacion> {
    return this.api.anularObligacion({
      consultorioId,
      obligacionId,
      anularObligacion: { motivo, version },
    });
  }

  // -------------------------------------------------------------------------------------
  // Cobros — M19, AKINE-07.02
  // -------------------------------------------------------------------------------------

  /**
   * Registra un cobro y lo imputa a las deudas indicadas.
   *
   * <p><b>`idempotencyKey` no es opcional en la practica.</b> El contrato la declara opcional
   * porque el backend acepta un cuerpo sin ella, pero sin clave un doble click cobra dos veces y
   * emite dos comprobantes correlativos. Por eso esta fachada la exige en el tipo: dejarla
   * opcional aca seria dejar abierta la unica puerta por la que este circuito duplica dinero.
   *
   * <p>Reintentar con la <b>misma</b> clave y el mismo contenido devuelve el mismo cobro con el
   * mismo comprobante; con otro contenido devuelve 409 `idempotency-key-conflict`.
   *
   * <p>El cuerpo se arma afuera, y afuera se garantiza que las dos sumas den el total: el servidor
   * lo revalida y responde 400 `cobro-no-cuadra`. Los importes llegan aca ya convertidos desde
   * centavos enteros —ver `models/dinero.ts`—: esta clase no hace ninguna cuenta.
   */
  registrarCobro(
    consultorioId: number,
    cobro: RegistrarCobro & { readonly idempotencyKey: string },
  ): Observable<Cobro> {
    return this.cobros.registrarCobro({ consultorioId, registrarCobro: cobro });
  }

  /** Los cobros del paciente en toda la organizacion, del mas reciente al mas viejo. */
  cobrosDeLaPersona(consultorioId: number, personaId: number): Observable<readonly Cobro[]> {
    return this.cobros.cobrosDeLaPersona({ consultorioId, personaId });
  }

  /**
   * Un cobro con su comprobante, sus medios y sus imputaciones.
   *
   * <p><b>Es la reimpresion, y por eso existe.</b> Sin esta lectura, un operador que necesita el
   * comprobante otra vez tendria como unica salida volver a registrar el cobro, que es
   * exactamente lo que la clave de idempotencia trata de evitar.
   *
   * <p>El listado ya trae medios e imputaciones, asi que releer no agrega campos: agrega
   * <b>frescura</b>. El comprobante que se reimprime es el que esta guardado ahora, no el que se
   * cargo en memoria hace veinte minutos.
   */
  verCobro(consultorioId: number, cobroId: number): Observable<Cobro> {
    return this.cobros.verCobro({ consultorioId, cobroId });
  }
}
