// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

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
    rules: {
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
          message:
            'Prohibido: igual de vulnerable a XSS que localStorage. Ver docs/adr/0001.',
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
