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
    },
  ],

  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
