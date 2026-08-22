# ADR-0003 — Proxy de desarrollo en lugar de una URL de API versionada

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Etapa:** AKINE-00.01

## Contexto

El frontend debe apuntar al backend local durante el desarrollo y el QA, y a la URL real en
producción.

El patrón habitual es un archivo con la URL —`environment.ts`, `client.js`, `constants.ts`—
que se cambia a `localhost` antes de probar y se revierte después. El template de QA de la
organización lo contempla explícitamente como "Local API Switch", con la instrucción de
**revertirlo siempre** al terminar.

Ese "siempre" es la señal de alarma: la instrucción existe porque el olvido es frecuente. Y
cuando se olvida, la URL de localhost se commitea y llega a un entorno compartido, donde el
frontend queda apuntando a la máquina de alguien que no está. El síntoma —"no carga nada"—
no señala la causa, y se pierde tiempo hasta encontrarla.

## Decisión

**No existe ninguna URL de API en el código.**

`environment.apiBaseUrl` está **vacío a propósito**. Todas las peticiones salen como rutas
relativas (`/api/...`), y en desarrollo el proxy de Angular las redirige al backend local:

```json
{
  "/api":          { "target": "http://localhost:8080", "changeOrigin": true },
  "/actuator":     { "target": "http://localhost:8080", "changeOrigin": true },
  "/v3/api-docs":  { "target": "http://localhost:8080", "changeOrigin": true }
}
```

El proxy se activa desde el script `start`:

```json
"start": "ng serve --proxy-config proxy.conf.json"
```

En producción, el reverse proxy que sirve la SPA enruta `/api` al backend. La topología se
decide en infraestructura, no en el bundle.

**Consecuencia buscada: no hay nada que cambiar antes de un QA ni nada que revertir después.**
El "Local API Switch" del template de QA queda documentado como *no aplica*.

## Alternativas consideradas

**`environment.ts` con la URL, reemplazado en build (`fileReplacements`).** El mecanismo
estándar de Angular. Descartada porque el archivo de desarrollo sigue conteniendo una URL
que alguien puede cambiar y commitear. Reduce el riesgo en producción pero no elimina la
clase de bug en desarrollo, que es donde ocurre.

**URL por variable de entorno inyectada en build.** Más limpio que un archivo versionado, y
compatible con contenedores. Descartada para desarrollo local porque agrega configuración
que cada integrante debe reproducir en su máquina, y el proxy resuelve lo mismo con cero
configuración. Sigue siendo la opción correcta si en el futuro el frontend necesita apuntar
a un backend en otro origen.

**Servir el frontend desde el propio backend.** Elimina el problema por completo: mismo
origen, sin CORS, sin proxy. Descartada porque el plan decide dos desplegables separados,
con pipelines y ciclos de vida independientes.

## Consecuencias

### Positivas

- **Es imposible commitear una URL de localhost**: no hay ninguna URL que commitear.
- Un integrante nuevo clona, corre `npm start` y funciona. Sin configuración previa.
- Mismo origen en desarrollo: no hay preflight de CORS que depurar localmente.
- El QA no tiene un paso manual que olvidar.

### Negativas

- **`ng serve` a secas no funciona**: sin el proxy, `/api` devuelve el `index.html` de
  Angular y el error que llega al código es un `SyntaxError` de JSON, que no señala la
  causa real. Hay que usar siempre `npm start`.
- El proxy solo aplica al dev server. Cualquier otra forma de servir el build necesita su
  propio enrutado.
- La configuración de producción se muda a infraestructura, que queda fuera de este
  repositorio: el frontend ya no es autocontenido respecto de dónde vive su API.
- Si alguna vez el backend debe estar en otro origen, esta decisión hay que revisarla.

### Qué obliga a hacer

- Usar **siempre** `npm start`, nunca `ng serve` pelado. Documentado en `CLAUDE.md`,
  en `.claude/qa-config.md` y en la nota de gotchas.
- Todo endpoint nuevo cuelga de un prefijo cubierto por `proxy.conf.json`. Si se agrega uno
  nuevo, hay que agregarlo al proxy.
- El despliegue documenta cómo se enruta `/api`.
