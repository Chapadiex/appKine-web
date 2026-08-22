# ADR-0002 — Cliente API generado, con DTO manuales prohibidos

- **Estado:** Aceptado
- **Fecha:** 2026-08-22
- **Etapa:** AKINE-00.01

## Contexto

AKINE vive en dos repositorios independientes que **nunca comparten un commit atómico**. El
backend es propietario del contrato OpenAPI y lo publica versionado; el plan exige que el
frontend genere un cliente TypeScript desde una versión explícita del contrato y prohíbe
expresamente los DTO manuales duplicados.

El modo de falla que esto evita: alguien escribe a mano `interface Turno { fecha: string }`,
el backend renombra el campo a `fechaHora`, y el frontend compila perfecto. El error aparece
en runtime, con un `undefined` que se propaga hasta que alguien lo ve en pantalla —o peor,
hasta que se guarda mal.

Con 29 módulos y cientos de endpoints por delante, ese error ocurriría muchas veces.

## Decisión

El cliente vive en `src/app/api/generated/` y **se genera**, nunca se escribe:

```bash
npm run api:generate
```

Genera con `openapi-generator` 7.24.0 (generator `typescript-angular`) desde
`../appKine-api/openapi/akine-api.yaml`.

Reglas:

- **`src/app/api/generated/` no se edita a mano.** Si falta un campo, falta en el contrato:
  se pide al backend, no se parchea acá.
- **Prohibido declarar a mano un tipo que representa una entidad de la API.** Si estás
  escribiendo `interface Paciente`, está mal.
- La versión del contrato consumida se declara en `src/environments/environment.ts` y se
  verifica con `npm run api:check`, que la compara contra el contrato del backend.
- El pipeline regenera el cliente y falla si difiere del commiteado.
- El directorio está en `.prettierignore` y en los `ignores` de ESLint: formatearlo o
  lintearlo rompería el gate de drift en cada corrida, porque el generador produce su propio
  estilo.

## Alternativas consideradas

**Servicios y tipos escritos a mano.** Control total sobre la forma del cliente y código más
idiomático. Descartada: es exactamente lo que el plan prohíbe, y por buen motivo. El costo de
mantener a mano el espejo de cientos de endpoints es alto y, sobre todo, **silencioso**: nada
avisa cuando se desincroniza.

**`ng-openapi-gen`.** Específico de Angular, output más legible y liviano. Descartada por
comunidad mucho más chica: ante un bug con OpenAPI 3.1 hay menos dónde agarrarse. Es la
segunda opción si openapi-generator diera problemas.

**`orval`.** DX moderna y muy buena. Descartada: está orientado a react-query y axios, y su
soporte de Angular es el más débil de los tres.

**Generar el cliente en tiempo de build en lugar de commitearlo.** Evita el ruido del código
generado en los diffs. Descartada porque acopla el build del frontend a tener el repo del
backend disponible y en la versión correcta, y porque sin el archivo commiteado no hay forma
de ver en un PR qué cambió del contrato.

## Consecuencias

### Positivas

- Un cambio incompatible de la API **rompe la compilación**, que es el momento más barato
  para descubrirlo.
- No hay forma de que los tipos del frontend se desincronicen del contrato sin que algo falle.
- La documentación del contrato —descripciones, ejemplos— llega al editor vía los tipos.

### Negativas

- El código generado es verboso y ensucia los diffs cuando cambia. Nadie lo lee, pero
  aparece.
- Genera un `package.json`, `tsconfig.json` y `ng-package.json` propios dentro del
  directorio, que no se usan pero están.
- Hay que recordar regenerar tras cada cambio de contrato. CI lo recuerda con un fallo.
- Requiere JVM instalada (openapi-generator corre sobre Java).
- La calidad del cliente depende de la calidad de las anotaciones del backend.

### Qué obliga a hacer

- Tras cada publicación de contrato: `npm run api:generate`, actualizar `contractVersion`
  en `environment.ts` y `environment.prod.ts`, y commitear ambas cosas juntas.
- **Nunca** editar `src/app/api/generated/`, ni siquiera "solo este campo".
- Los servicios de feature consumen el cliente generado, no `HttpClient` crudo.
- Si el generador produce algo inutilizable, el arreglo va en el **contrato del backend**
  o en la configuración del generador, jamás en el output.
