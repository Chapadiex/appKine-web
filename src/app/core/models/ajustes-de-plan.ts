/**
 * Lo que un centro tiene que ajustar para bajar a un plan con menos topes (26/11/2026). Lo usan la
 * Suscripción del centro y la bandeja de cambios de plan de la plataforma.
 *
 * "Tenés 3 sedes y el Plan Base permite 1: cerrá 2 sedes."
 */
export function textoDeAjuste(codigo: string, tope: number, uso: number, plan: string): string {
  const sobran = uso - tope;
  if (codigo === 'MAX_CONSULTORIOS') {
    return `Tenés ${uso} sedes y el ${plan} permite ${tope}: cerrá ${sobran === 1 ? '1 sede' : `${sobran} sedes`}.`;
  }
  return `Tenés ${uso} profesionales y el ${plan} permite ${tope}: dá de baja ${sobran === 1 ? 'a 1 profesional' : `a ${sobran} profesionales`}.`;
}
