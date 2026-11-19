import { Injectable, signal } from '@angular/core';

import { SolicitudDePruebaRequestSedesEnum } from '../../../api/generated/model/solicitud-de-prueba-request';
import { CantidadDeSedes, ConIa, ServiciosElegidos } from './armador-de-plan';

/**
 * Lo que el visitante eligió en el armador de planes, compartido con el formulario del pedido
 * de prueba para precargarlo. Vive en la página de la landing (`providers`), no en `root`: se
 * olvida al salir de la landing.
 */
@Injectable()
export class EleccionDelArmador {
  readonly sedes = signal<CantidadDeSedes>('una');
  readonly servicios = signal<ServiciosElegidos>('kinesiologia');
  readonly ia = signal<ConIa>('no');
}

export const SEDES_DEL_PEDIDO: Record<CantidadDeSedes, SolicitudDePruebaRequestSedesEnum> = {
  una: SolicitudDePruebaRequestSedesEnum.UNA,
  'hasta-tres': SolicitudDePruebaRequestSedesEnum.HASTA_TRES,
  'mas-de-tres': SolicitudDePruebaRequestSedesEnum.MAS_DE_TRES,
};
