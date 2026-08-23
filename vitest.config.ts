import { defineConfig } from 'vitest/config';

/**
 * Configuracion del runner de tests. La engancha `angular.json` con
 * `architect.test.options.runnerConfig`.
 *
 * <p><b>Por que existe este archivo.</b> El builder `@angular/build:unit-test` valida sus
 * opciones con `additionalProperties: false`, asi que `testTimeout` NO se puede escribir
 * directo en `angular.json` (falla con "Data path '' must NOT have additional properties").
 * El unico punto de extension que ofrece es `runnerConfig`, que apunta a un config de Vitest
 * como este. Todo lo demas -entorno jsdom, plugins de Angular, cobertura- lo sigue armando
 * el builder: aca solo se sobreescribe el timeout.
 */
export default defineConfig({
  test: {
    /**
     * 15 s por test, contra los 5 s por defecto de Vitest.
     *
     * <p><b>El problema medido.</b> La PRIMERA llamada a `axe.run` de cada archivo paga el
     * armado del motor de axe sobre jsdom: ~5,7 s medidos, contra ~0,5 s las siguientes. Con
     * diez archivos auditando en paralelo, esos arranques saturan los workers y empujan por
     * encima de los 5 s a tests de OTROS archivos que no tienen nada que ver -el flake
     * observado fue `register-page.spec.ts` con "Test timed out in 5000ms"-. Deshabilitar
     * `color-contrast` no lo arregla: medido 4,3 s en frio, el costo es el arranque, no la
     * regla.
     *
     * <p><b>Por que 15 s y no mas.</b> Tiene que cubrir el peor caso real -~6 s de arranque
     * de axe mas la contencion entre workers- con margen de sobra, y quedar POR DEBAJO de
     * {@link TIMEOUT_AXE} (20 s), que es el margen explicito que ya se le da a los `it` que
     * auditan. Subirlo mas convertiria un cuelgue de verdad -una promesa que nunca resuelve,
     * un `httpMock` que nadie flushea- en una espera larga antes de un fallo igual de fatal:
     * el timeout es un detector de bugs, no un colchon.
     */
    testTimeout: 15_000,
  },
});
