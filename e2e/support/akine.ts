import { execFileSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { randomUUID } from 'node:crypto';

import { APIRequestContext, Page, expect } from '@playwright/test';

/**
 * Utilidades compartidas por los E2E de AKINE-01.02.
 *
 * <p>Todo lo que hay aca golpea el stack REAL: el backend en 8080 a traves del proxy de dev, y
 * la base `akine_local` del contenedor `akine-mysql`. No hay mocks, ni `route.fulfill()`, ni
 * atajos de autenticacion: el motivo por el que los escenarios 10 y 11 quedaron diferidos desde
 * AKINE-01.01 es justamente que un atajo los pondria en verde sin probar el camino real.
 */

/** Contrasena sintetica que cumple la politica del backend. Datos de prueba, nunca reales. */
export const PASSWORD = 'una-contrasena-larga-y-unica-2026';

/**
 * Ejecuta SQL contra la base local y devuelve la salida cruda (tab-separated, sin cabecera).
 *
 * <p><b>Esto NO es una via legitima de la aplicacion.</b> Se usa exclusivamente para SEMBRAR
 * estado que el producto no expone de otra forma —ver {@link activarCuentaPorSql}— y jamas para
 * verificar un resultado que el E2E deberia leer de la pantalla.
 */
export function sql(consulta: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      // Contenedor de `appKine-api/compose.yaml`: el mismo nombre en desarrollo y en el CI.
      process.env['AKINE_E2E_MYSQL_CONTAINER'] ?? 'akine-mysql',
      'mysql',
      '-N',
      '-B',
      '-u',
      'akine',
      '-pakine',
      'akine_local',
      '-e',
      consulta,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
}

/** Email sintetico y unico. `@ejemplo.test` es un TLD reservado: no puede existir de verdad. */
export function emailUnico(prefijo: string): string {
  return `${prefijo}.${Date.now()}.${randomUUID().slice(0, 8)}@ejemplo.test`;
}

/** Sufijo unico para nombres de organizacion, para que su slug derivado no colisione. */
export function nonce(): string {
  return randomUUID().slice(0, 8);
}

export interface AltaSelfService {
  readonly email: string;
  readonly organizationName: string;
  readonly firstName?: string;
  readonly lastName?: string;
}

/**
 * Alta self-service por HTTP contra el backend real (`POST /api/v1/auth/register`).
 *
 * <p>Se usa para MONTAR los datos de un escenario, no para probarlo: el registro por pantalla
 * lo cubre `auth-flujo.spec.ts`. El header `Idempotency-Key` es obligatorio en el contrato.
 */
export async function registrarPorApi(
  request: APIRequestContext,
  datos: AltaSelfService,
): Promise<void> {
  const clave = randomUUID();
  const respuesta = await conReintentoPor429(() =>
    request.post('/api/v1/auth/register', {
      headers: { 'Idempotency-Key': clave },
      data: {
        firstName: datos.firstName ?? 'Ana',
        lastName: datos.lastName ?? 'Prueba',
        email: datos.email,
        password: PASSWORD,
        organizationName: datos.organizationName,
      },
    }),
  );

  expect(respuesta.status(), 'el alta self-service responde 202 uniforme (ADR-0018)').toBe(202);
}

/**
 * Pide cupo con {@link esperarCupoDeRegistro} y hace el alta; ante un 429 espera y reintenta.
 *
 * <p>El espaciado del cliente es una ventana deslizante y el limite del servidor es una ventana
 * fija: en el borde de la ventana el servidor puede contar un alta de mas y responder 429 con
 * `reintentarEnSegundos=0` (visto el 08/10/2026, AKINE G-9). Un 429 no procesa el alta, asi que
 * repetir con la misma `Idempotency-Key` es seguro.
 */
export async function conReintentoPor429<T extends { status(): number }>(
  alta: () => Promise<T>,
): Promise<T> {
  for (let intento = 1; ; intento++) {
    await esperarCupoDeRegistro();
    const respuesta = await alta();
    if (respuesta.status() !== 429 || intento === 3) {
      return respuesta;
    }
    await dormir(5_000);
  }
}

/**
 * Deja la cuenta ACTIVA escribiendo directamente en la base.
 *
 * <p><b>SEMBRADO DECLARADO — el tramo de activacion NO queda cubierto por E2E.</b>
 *
 * <p>El token de activacion solo existe en claro en el proceso que lo genero: `token_verificacion`
 * guarda unicamente su SHA-256, y el enlace armado vive en un `SecureLinkVault` en memoria del que
 * se consume una sola vez. `LogEmailSender` —el adaptador activo en modo `log`— documenta
 * explicitamente que NO imprime el enlace ni el cuerpo, y los logs reales lo confirman:
 * `cuerpo=<omitido 235 caracteres>`. No hay ninguna via externa para obtener el token en claro.
 *
 * <p>La alternativa habria sido un backdoor de activacion o un `route.fulfill()` simulando la
 * respuesta: las dos dejan el test en verde sin probar nada. Se siembra el estado por SQL, se
 * declara aca, y `POST /api/v1/auth/activate` queda reportado como tramo NO cubierto por E2E.
 * Es el mismo criterio que aplicaron los tests de integracion del backend.
 */
export function activarCuentaPorSql(email: string): void {
  sql(
    `UPDATE cuenta SET estado='ACTIVA', updated_at=NOW(6) WHERE email_normalizado='${email.toLowerCase()}'`,
  );
  expect(
    estadoDeCuenta(email),
    'el sembrado por SQL dejo la cuenta ACTIVA (si esto falla, el sembrado no aplico)',
  ).toBe('ACTIVA');
}

export function estadoDeCuenta(email: string): string {
  return sql(`SELECT estado FROM cuenta WHERE email_normalizado='${email.toLowerCase()}'`);
}

export function idDeCuenta(email: string): number {
  const id = sql(`SELECT id FROM cuenta WHERE email_normalizado='${email.toLowerCase()}'`);
  expect(id, `la cuenta ${email} existe en la base`).not.toBe('');
  return Number(id);
}

export function idDeOrganizacion(nombre: string): number {
  const id = sql(`SELECT id FROM organization WHERE name='${nombre}'`);
  expect(id, `la organizacion ${nombre} existe en la base`).not.toBe('');
  return Number(id);
}

export function idDePrimerConsultorio(organizationId: number): number {
  const id = sql(
    `SELECT id FROM consultorio WHERE organization_id=${organizationId} ORDER BY id LIMIT 1`,
  );
  expect(id, `la organizacion ${organizationId} tiene consultorio`).not.toBe('');
  return Number(id);
}

/**
 * Vincula una cuenta a una segunda organizacion.
 *
 * <p>SEMBRADO DECLARADO: el alta self-service crea UNA organizacion por cuenta, y la gestion de
 * invitaciones y altas de miembros es de AKINE-01.03. Sin este vinculo no hay forma de tener una
 * cuenta con dos contextos, que es la precondicion del escenario 10.
 */
export function darMembership(accountId: number, organizationId: number): void {
  sql(
    `INSERT INTO membership (organization_id, consultorio_id, account_id, role_code, is_founder,` +
      ` valid_from, active, version, created_at, updated_at)` +
      ` VALUES (${organizationId}, NULL, ${accountId}, 'ORG_ADMIN', 0,` +
      // Un minuto atras y no NOW(6): `valid_from` lo compara el backend contra SU reloj, y si el
      // del contenedor de MySQL va adelantado medio segundo la membership todavia no vale en el
      // login que sigue y la cuenta entra con un solo contexto (visto el 08/10/2026, AKINE G-9).
      ` NOW(6) - INTERVAL 1 MINUTE, 1, 0, NOW(6), NOW(6))`,
  );
}

/**
 * Campo de un formulario, buscado por su etiqueta REAL.
 *
 * <p>Se acota al `<form>` a proposito. Las tarjetas de estas pantallas llevan
 * `aria-labelledby` apuntando al `<h2>` de la seccion, asi que la seccion tiene nombre
 * accesible propio ("Tu email", "Contrasena nueva") y `getByLabel` de pagina entera choca en
 * modo estricto con el input homonimo. Buscar por `id` esconderia el problema; buscar por
 * etiqueta dentro del formulario prueba lo que AGENT.md 8 exige: que cada campo tenga label
 * real y quede asociado.
 */
export function campo(page: Page, etiqueta: string | RegExp, opciones?: { exact?: boolean }) {
  return page.locator('form').getByLabel(etiqueta, opciones);
}

/** Login por PANTALLA: el camino real, contra el backend real. */
export async function ingresarPorPantalla(page: Page, email: string): Promise<void> {
  await page.goto('/auth/ingresar');
  await campo(page, 'Email').fill(email);
  await campo(page, 'Contrasena').fill(PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesion' }).click();
}

/** Fragmentos internos que ninguna respuesta ni pantalla puede exponer (ADR-0005). */
export const INTERNALS = ['com.akine', 'org.springframework', 'stacktrace'] as const;

/** Falla nombrando el fragmento filtrado, para que el reporte diga QUE se filtro y no solo que fallo. */
export function esperarSinInternals(texto: string, deDonde: string): void {
  const minuscula = texto.toLowerCase();
  for (const fragmento of INTERNALS) {
    expect(minuscula, `${deDonde} no puede exponer "${fragmento}"`).not.toContain(fragmento);
  }
  // `at com.` / `\tat ` es la firma de un stack trace de la JVM aunque no aparezca la palabra.
  expect(minuscula, `${deDonde} no puede exponer un stack trace de la JVM`).not.toMatch(
    /\bat [a-z]+(\.[a-z0-9_$]+){3,}\(/i,
  );
}

// ---------------------------------------------------------------------------------------------
// Throttle del alta self-service — INFRAESTRUCTURA DE TEST, agregada por QA para la corrida E2E.
//
// El backend limita `POST /api/v1/auth/register` a 5 intentos por minuto y por IP
// (`akine.security.rate-limit.register-max-attempts`, ventana fija de 1m, clave ruta+IP).
// La suite completa dispara ~18 altas y TODAS salen de 127.0.0.1 —el proxy de dev y el
// `request` fixture comparten origen—, asi que sin espaciarlas el sexto request de cada minuto
// vuelve 429 y los tests fallan por el limite, no por el producto.
//
// Se decidio ESPACIAR las altas, no desactivar el limite: el limite es la proteccion que la
// etapa acaba de agregar y apagarlo para que la suite pase invalidaria la corrida.
//
// El contador vive en un archivo porque Playwright corre varios workers en PROCESOS distintos:
// un contador en memoria del modulo no los coordinaria. Ventana deslizante de 4 altas por 60s,
// una menos que el cupo real, para tolerar el desfasaje entre el instante que se anota aca y el
// que el servidor contabiliza.
// ---------------------------------------------------------------------------------------------

const CUPO_DE_REGISTRO = 4;
/**
 * La ventana del servidor (60 s) mas un margen. La marca se anota ANTES de enviar —en los flujos
 * de pantalla, a veces antes de llenar el formulario—, y la ventana fija del servidor abre con la
 * primera LLEGADA: con ese desfasaje, dos tandas de 4 pueden caer en la misma ventana del
 * servidor y la quinta vuelve 429. El margen cubre el desfasaje (AKINE A-6).
 */
const VENTANA_DE_REGISTRO_MS = 70_000;
const LEDGER_DE_REGISTRO = nodePath.join(nodeOs.tmpdir(), 'akine-e2e-registros.json');
const CERROJO_DE_REGISTRO = nodePath.join(nodeOs.tmpdir(), 'akine-e2e-registros.lock');

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cerrojo entre procesos: `mkdir` es atomico, y falla si el directorio ya existe. */
async function tomarCerrojo(): Promise<void> {
  for (let intento = 0; intento < 600; intento++) {
    try {
      nodeFs.mkdirSync(CERROJO_DE_REGISTRO);
      return;
    } catch {
      await dormir(50);
    }
  }
  // Cerrojo huerfano (un worker murio con el tomado): se fuerza en vez de colgar la suite.
  try {
    nodeFs.rmSync(CERROJO_DE_REGISTRO, { recursive: true, force: true });
    nodeFs.mkdirSync(CERROJO_DE_REGISTRO);
  } catch {
    /* si tampoco se pudo, seguir sin cerrojo es preferible a bloquear la corrida */
  }
}

function soltarCerrojo(): void {
  try {
    nodeFs.rmSync(CERROJO_DE_REGISTRO, { recursive: true, force: true });
  } catch {
    /* ya no estaba */
  }
}

function leerLedger(): number[] {
  try {
    const crudo = JSON.parse(nodeFs.readFileSync(LEDGER_DE_REGISTRO, 'utf8')) as unknown;
    return Array.isArray(crudo) ? (crudo as number[]) : [];
  } catch {
    return [];
  }
}

/**
 * Espera hasta que haya cupo para UNA alta y anota el intento.
 *
 * <p>Hay que llamarla antes de cada request a `/api/v1/auth/register`, venga del `request`
 * fixture o del formulario de pantalla: el limite del backend no distingue de donde salio.
 */
export async function esperarCupoDeRegistro(): Promise<void> {
  for (;;) {
    await tomarCerrojo();
    let esperar = 0;
    try {
      const ahora = Date.now();
      const vigentes = leerLedger().filter((t) => ahora - t < VENTANA_DE_REGISTRO_MS);
      if (vigentes.length < CUPO_DE_REGISTRO) {
        vigentes.push(ahora);
        nodeFs.writeFileSync(LEDGER_DE_REGISTRO, JSON.stringify(vigentes));
      } else {
        esperar = Math.min(...vigentes) + VENTANA_DE_REGISTRO_MS - ahora + 500;
        nodeFs.writeFileSync(LEDGER_DE_REGISTRO, JSON.stringify(vigentes));
      }
    } finally {
      soltarCerrojo();
    }

    if (esperar <= 0) {
      return;
    }
    await dormir(esperar);
  }
}
