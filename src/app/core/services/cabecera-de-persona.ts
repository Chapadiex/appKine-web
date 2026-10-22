import { Signal, computed, effect, inject } from '@angular/core';

import type { ModeloDeCabeceraDeFicha } from '../../shared/components/cabecera-de-ficha/cabecera-de-ficha';
import { DatosDeCabeceraDePersona, modeloDeCabeceraDePersona } from '../models/cabecera-de-persona';
import { PermissionsStore } from './permissions.store';

/**
 * La banda de la persona como signal, para `<app-cabecera-de-ficha [modelo]="cabecera()">`.
 *
 * <p>Se llama en el contexto de inyeccion de la pagina (un campo o el constructor). Pide los
 * permisos si todavia no estan, y la lista de pestanas se rehace cuando terminan de cargar: sin
 * eso una pantalla abierta por URL mostraria la banda sin las pestanas que dependen de permisos.
 */
export function cabeceraDePersona(
  datos: () => DatosDeCabeceraDePersona,
): Signal<ModeloDeCabeceraDeFicha> {
  const permisos = inject(PermissionsStore);
  effect(() => {
    if (!permisos.cargados()) {
      permisos.asegurarCargados();
    }
  });
  return computed(() => {
    permisos.permisos();
    return modeloDeCabeceraDePersona(datos(), (permiso) => permisos.tiene(permiso));
  });
}
