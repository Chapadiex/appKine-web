import { defineConfig, devices } from '@playwright/test';

/**
 * Configuracion E2E de AKINE (AKINE-00.01).
 *
 * Los E2E exigen el stack completo levantado: base, backend y frontend. Playwright arranca
 * el frontend por su cuenta (`webServer`), pero NO el backend: levantarlo desde aca
 * esconderia fallos de arranque que el QA debe ver.
 *
 * Precondiciones, en orden:
 *   1. cd ../appKine-api && docker compose up -d
 *   2. cd ../appKine-api && ./mvnw spring-boot:run -Dspring-boot.run.profiles=local
 *   3. npm run e2e
 *
 * Regla innegociable: ambos repos en la MISMA rama. Si no, se prueban dos versiones
 * distintas y el resultado no vale.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  // Un .only olvidado hace que CI pase probando un solo caso. En CI eso es un error.
  forbidOnly: !!process.env['CI'],

  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,

  reporter: process.env['CI'] ? [['html'], ['github']] : [['html']],

  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // La auditoria de contraste tiene sus propios dos proyectos, uno por tema. Sin esto
      // correria una tercera vez con el `colorScheme` que traiga el sistema del runner, que es
      // justamente el dato que no se puede dejar al azar.
      testIgnore: /contraste(-no-textual)?\.spec\.ts/,
    },

    /*
     * Auditoria de contraste (WCAG 1.4.3 AA), un proyecto por tema.
     *
     * Son dos proyectos y no dos `test.use` dentro del spec porque el tema NO es un caso de
     * prueba: es el entorno en el que TODOS los casos tienen que valer. Partido en proyectos, el
     * reporte dice "contraste-oscuro / padron con un error del servidor" y se sabe de una que la
     * falla es del modo oscuro; un solo proyecto con los dos temas adentro duplicaria cada
     * `test()` a mano y el dia que alguien agregue el noveno se va a olvidar de la mitad.
     *
     * A diferencia del proyecto `chromium`, estos NO necesitan el backend: la API se simula con
     * `route.fulfill`. Corren en cualquier maquina y en CI.
     *
     * Desde AKINE-G-7 corren tambien `contraste-no-textual.spec.ts`: contorno de controles y
     * anillo de foco a 3:1 (WCAG 1.4.11), hover y recorrido por teclado. Los bordes y el foco
     * cambian de token entre temas igual que el texto, asi que necesitan los mismos dos proyectos.
     */
    {
      name: 'contraste-claro',
      testMatch: /contraste(-no-textual)?\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    {
      name: 'contraste-oscuro',
      testMatch: /contraste(-no-textual)?\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
  ],

  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
