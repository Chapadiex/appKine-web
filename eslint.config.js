// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const path = require('node:path');

/**
 * Raiz de las features, normalizada con `/` para comparar igual en Windows y en Linux.
 */
const FEATURES_DIR = path.resolve(__dirname, 'src/app/features').split(path.sep).join('/');

/**
 * Excepciones a la regla 4 de ADR-0004 ("un feature no importa de otro feature").
 *
 * Cada entrada es `<feature que importa> -> <archivo importado, relativo a features/>`.
 * Solo se admiten excepciones que involucran a `features/clinical`: esa feature la trabaja
 * otra linea en paralelo y no se toca desde aca. Cualquier otro import entre features se
 * resuelve subiendo lo comun a `shared/` (sin dominio) o `core/`, no agregandolo a esta lista.
 *
 * Que la lista sea por ARCHIVO y no por par de features es a proposito: un import nuevo
 * desde clinical a otro archivo de la misma feature vuelve a fallar y obliga a decidir.
 */
const EXCEPCIONES_ENTRE_FEATURES = new Set([
  // Vacia: al introducir la regla (11/10/2026) clinical no importaba de ninguna otra feature
  // y ninguna importaba de clinical. Formato: 'clinical -> person/models/x', con su porque.
]);

/**
 * Regla local: ADR-0004 regla 4. Resuelve el import relativo contra el archivo que lo
 * declara -no se puede expresar con `no-restricted-imports`, que solo ve el texto del
 * import y no sabe si `../../person` sale de la feature o no- y falla si cae en otra
 * carpeta de `src/app/features/`.
 *
 * Cubre `import`, `export ... from` e `import()` dinamico. Los imports no relativos
 * (`@angular/...`, `@akine/api-client`) no apuntan a una feature y se ignoran.
 */
const reglaSinImportsEntreFeatures = {
  meta: {
    type: 'problem',
    docs: { description: 'Prohibe que una feature importe de otra (ADR-0004, regla 4).' },
    schema: [],
    messages: {
      entreFeatures:
        "La feature '{{origen}}' no puede importar de la feature '{{destino}}' ({{archivo}}). " +
        'Lo comun sube a shared/ (sin reglas de dominio) o core/. Ver docs/adr/0004.',
    },
  },
  create(context) {
    const archivo = context.filename.split(path.sep).join('/');
    if (!archivo.startsWith(FEATURES_DIR + '/')) return {};
    const origen = archivo.slice(FEATURES_DIR.length + 1).split('/')[0];

    /** @param {any} fuente */
    function revisar(fuente) {
      if (!fuente || typeof fuente.value !== 'string' || !fuente.value.startsWith('.')) return;
      const destinoAbs = path
        .resolve(path.dirname(context.filename), fuente.value)
        .split(path.sep)
        .join('/');
      if (!destinoAbs.startsWith(FEATURES_DIR + '/')) return;
      const relativo = destinoAbs.slice(FEATURES_DIR.length + 1);
      const destino = relativo.split('/')[0];
      if (destino === origen) return;
      if (EXCEPCIONES_ENTRE_FEATURES.has(`${origen} -> ${relativo}`)) return;
      context.report({
        node: fuente,
        messageId: 'entreFeatures',
        data: { origen, destino, archivo: relativo },
      });
    }

    return {
      ImportDeclaration: (n) => revisar(n.source),
      ExportNamedDeclaration: (n) => revisar(n.source),
      ExportAllDeclaration: (n) => revisar(n.source),
      ImportExpression: (n) => revisar(n.source),
    };
  },
};

/**
 * Configuracion de ESLint de AKINE (AKINE-00.02).
 *
 * Sigue la misma filosofia que los tests de arquitectura del backend (ADR-0006): las
 * reglas que importan se verifican automaticamente, no se confian a la revision. Cada
 * regla propia declara que bug concreto previene.
 */
module.exports = defineConfig([
  {
    // El cliente de la API se genera desde openapi/akine-api.yaml y NO se edita a mano.
    // Lintearlo no aporta nada -sus avisos no son accionables- y ademas romperia el gate
    // de drift del pipeline, que compara el generado contra el commiteado.
    // Mismo motivo por el que esta en .prettierignore.
    ignores: ['src/app/api/generated/**', 'dist/**', '.angular/**', 'coverage/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    plugins: {
      akine: { rules: { 'sin-imports-entre-features': reglaSinImportsEntreFeatures } },
    },
    rules: {
      // ADR-0004 regla 4: un feature no importa de otro. Antes dependia de la revision y era
      // la mas fragil de las seis; un import cruzado acopla dos dominios lazy-loaded (el
      // chunk de uno arrastra al otro) y es el camino por el que la regla de negocio de un
      // modulo termina decidiendo en la pantalla de otro.
      'akine/sin-imports-entre-features': 'error',

      // Dos prefijos: `app` para las directivas de atributo comunes y `akine` para las que
      // se usan como directiva estructural (`*akinePermiso`). En la microsintaxis el
      // prefijo queda a la vista en cada plantilla, y `*appPermiso` se lee como si fuera de
      // Angular; `*akinePermiso` deja claro de quien es la regla que oculta el boton.
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: ['app', 'akine'], style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],

      // Angular 22 cambia el default de deteccion de cambios a OnPush y `ng update` le puso
      // `ChangeDetectionStrategy.Eager` a los 72 componentes que no declaraban estrategia,
      // para que se comporten EXACTAMENTE igual que en Angular 21. angular-eslint 22 trae en
      // `tsRecommended` esta regla, que marca cada uno de esos Eager como error.
      //
      // Se apaga a proposito, y es deuda declarada: pasar un componente a OnPush puede dejar
      // de refrescar una vista que hoy depende de un campo plano mutado fuera de un signal, y
      // eso no lo detecta el compilador sino un test o un usuario. La migracion de framework
      // va sola; el pase a OnPush se hace por feature, con sus specs y E2E, en otro PR.
      // Cuando no quede ningun Eager, esta linea se borra.
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',

      // --- Reglas propias de AKINE ---------------------------------------------------

      // El access token vive UNICAMENTE en memoria (ADR-0008 del frontend). AKINE maneja
      // historia clinica: un XSS -propio o de cualquier dependencia npm- lee todo el
      // storage del navegador, y con ese token accede a datos de salud de pacientes.
      //
      // Si alguna vez hace falta storage para una preferencia de UI no sensible, se agrega
      // una excepcion explicita en este archivo, justificada. Que sea una decision
      // consciente y no un descuido es exactamente el punto.
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message:
            'Prohibido: un XSS lo lee entero. El access token va en memoria (AuthTokenStore) ' +
            'y el refresh en cookie httpOnly. Ver docs/adr/0001.',
        },
        {
          name: 'sessionStorage',
          message: 'Prohibido: igual de vulnerable a XSS que localStorage. Ver docs/adr/0001.',
        },
      ],

      // El logging de produccion no se hace con console.log: no tiene nivel, no se puede
      // filtrar y es la via mas facil de dejar un dato clinico en la consola del navegador.
      // warn y error se permiten para fallos genuinos.
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // Una promesa sin await ni catch se traga los errores en silencio.
      'no-void': 'error',

      // Preferir el tipo explicito antes que any: el cliente generado ya nos da tipos,
      // desaprovecharlos anula la razon de generarlo.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [
      angular.configs.templateRecommended,
      // WCAG 2.1 AA es requisito del proyecto, no aspiracion: labels reales, roles validos,
      // alt en imagenes, elementos interactivos alcanzables por teclado.
      angular.configs.templateAccessibility,
    ],
    rules: {},
  },
  {
    // Los E2E corren en Node y usan la API de Playwright, no la de Angular.
    files: ['e2e/**/*.ts', '*.config.ts', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
]);
