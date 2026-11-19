import { DestroyRef } from '@angular/core';
import { Meta, MetaDefinition } from '@angular/platform-browser';

/**
 * Metadatos de la página pública (Modern Web Guidance, 19/11/2026): descripción para buscadores,
 * Open Graph para que el enlace se vea bien al compartirlo, URL canónica y datos estructurados del
 * producto. Se publican al entrar a la landing y se retiran al salir: las pantallas internas no son
 * públicas y no tienen por qué describirse para buscadores.
 */
export const DESCRIPCION_DE_LANDING =
  'Turnos, recepción, historia clínica, obras sociales, clases y caja en una sola aplicación para ' +
  'centros de kinesiología, rehabilitación y actividades. Probalo gratis 30 días.';

const TITULO = 'AKINE · Gestión para centros de salud y actividades';

export function publicarMetadatosDeLanding(
  meta: Meta,
  documento: Document,
  destruccion: DestroyRef,
): void {
  const url = documento.location?.origin ? `${documento.location.origin}/` : '/';
  const etiquetas: MetaDefinition[] = [
    { name: 'description', content: DESCRIPCION_DE_LANDING },
    { property: 'og:type', content: 'website' },
    { property: 'og:locale', content: 'es_AR' },
    { property: 'og:site_name', content: 'AKINE' },
    { property: 'og:title', content: TITULO },
    { property: 'og:description', content: DESCRIPCION_DE_LANDING },
    { property: 'og:url', content: url },
    { name: 'twitter:card', content: 'summary' },
  ];
  const publicadas = etiquetas
    .map((etiqueta) => meta.updateTag(etiqueta))
    .filter((elemento): elemento is HTMLMetaElement => elemento !== null);

  const canonica = documento.createElement('link');
  canonica.rel = 'canonical';
  canonica.href = url;
  documento.head.appendChild(canonica);

  // SoftwareApplication: qué es, para quién y que la prueba es gratis. Sin precios (decisión del
  // 18/11/2026): la oferta declara sólo la prueba.
  const datos = documento.createElement('script');
  datos.type = 'application/ld+json';
  datos.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'AKINE',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: DESCRIPCION_DE_LANDING,
    url,
    inLanguage: 'es-AR',
    offers: {
      '@type': 'Offer',
      description: 'Prueba gratis de 30 días',
      price: '0',
      priceCurrency: 'ARS',
    },
  });
  documento.head.appendChild(datos);

  destruccion.onDestroy(() => {
    publicadas.forEach((elemento) => elemento.remove());
    canonica.remove();
    datos.remove();
  });
}
