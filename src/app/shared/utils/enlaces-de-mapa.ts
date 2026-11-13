/**
 * Enlaces y texto de una coordenada, para salir del mapa propio a uno externo.
 *
 * <p>Google Maps acepta las coordenadas por URL sin clave ni cuenta (`api=1`). Los enlaces se arman
 * acá para que ninguna pantalla concatene URLs a mano.
 */

/** Abre el punto en Google Maps, como búsqueda: muestra el lugar sin pedir origen. */
export function enlaceVerEnGoogleMaps(latitud: number, longitud: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitud},${longitud}`;
}

/** Abre Google Maps en modo "cómo llegar" con el punto como destino; el origen lo elige el usuario. */
export function enlaceComoLlegar(latitud: number, longitud: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${latitud},${longitud}`;
}

/** Las coordenadas como se muestran: cuatro decimales (≈11 m) y punto decimal, "-34.5593, -58.4526". */
export function coordenadasFormateadas(latitud: number, longitud: number): string {
  return `${latitud.toFixed(4)}, ${longitud.toFixed(4)}`;
}
