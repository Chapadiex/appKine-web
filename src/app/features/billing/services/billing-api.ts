import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { Obligacion } from '../../../api/generated/model/obligacion';
import { ObligacionesService } from '../../../api/generated/api/obligaciones.service';
import { PersonaResponse } from '../../../api/generated/model/persona-response';
import { PersonasService } from '../../../api/generated/api/personas.service';

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
 * <h2>Lo que esta fachada NO tiene</h2>
 *
 * <p><b>No hay cobrar.</b> AKINE-07.02 es otra etapa y el contrato todavia no publica el
 * endpoint. Obligacion, Cobro y Caja son tres cosas distintas (regla maestra 5) y esta capa cubre
 * la primera.
 *
 * <p><b>Tampoco hay crear una obligacion.</b> No es una omision: la deuda se <b>deriva</b> del
 * cierre de la sesion, del lado del backend, y no se carga a mano. Un metodo de alta aca abriria
 * la puerta a una cuenta corriente sin prestacion que la justifique.
 *
 * <p>Y no hay devolucion: cuando la deuda ya tiene cobros imputados lo que corresponde es una
 * devolucion, que es M19 y tiene su propio registro. Fuera de alcance por DP-10.
 */
@Injectable({ providedIn: 'root' })
export class BillingApi {
  private readonly api = inject(ObligacionesService);
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
   * <p><b>`deLaPersona1` con el `1` pegado es el nombre que genera el cliente</b>, no un typo. El
   * contrato 0.21.0 tiene dos operaciones distintas llamadas `deLaPersona` —una en Obligaciones y
   * otra en otro tag— y el generador desambigua sufijando la segunda. Es fragil: si el backend
   * agrega, saca o renombra la otra, este numero se mueve y esta linea deja de compilar. La
   * solucion real es un `operationId` unico del lado del contrato.
   */
  deLaPersona(consultorioId: number, personaId: number): Observable<readonly Obligacion[]> {
    return this.api.deLaPersona1({ consultorioId, personaId });
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
    return this.api.anular({
      consultorioId,
      obligacionId,
      anularObligacion: { motivo, version },
    });
  }
}
