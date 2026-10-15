import { expect, ingresar, navegar, test } from './support/agenda-real';
import {
  ApiAkine,
  cerrarSesionDelTurno,
  comoProfesional,
  crearOferta,
  diaDeTrabajo,
  fijarPrecio,
  reservarElPrimeroLibre,
} from './support/sembrado';
import { sembrarPrestacionFinanciada } from './support/sembrado-pantallas-098';
import { DIAS_INVENTARIO } from './support/sembrado-inventario';

/**
 * E2E del concepto y el convenio de cada deuda en la cuenta corriente (F-4, #42) contra el backend
 * REAL.
 *
 * <p>Una misma persona con cobertura FINANCIADA cierra dos sesiones: una en una oferta con convenio
 * (el devengado le deja el COSEGURO, y la deuda del financiador va aparte) y otra en una oferta que no
 * admite obra social (PARTICULAR, a precio de lista). La cuenta corriente tiene que distinguirlas por
 * concepto, decir de que convenio sale el coseguro, y mostrar el precio congelado al devengar.
 */
const IMPORTES = { total: 11000, financiador: 8800, coseguro: 2200 };
const PARTICULAR = 6500;

interface DeudaConConvenio {
  readonly id: number;
  readonly concepto: string;
  readonly importeOriginal: number;
  readonly convenio?: { readonly convenioNombre?: string } | null;
}

/** El importe como lo redacta billing (`$ 2.200,00`), sin depender del espacio de `Intl`. */
function pesos(importe: number): RegExp {
  const numero = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2 }).format(importe);
  return new RegExp(numero.replace(/\./g, '\\.'));
}

test.describe('Cuenta corriente con concepto contra el backend real', () => {
  let profesional: ApiAkine;

  test.beforeAll(async ({ centro }) => {
    profesional = await comoProfesional(centro);
  });

  test.afterAll(async () => {
    await profesional.cerrar();
  });

  test('coseguro con su convenio y particular, en la misma cuenta', async ({
    page,
    api,
    centro,
  }) => {
    test.slow();
    const { persona } = await sembrarPrestacionFinanciada(
      api,
      profesional,
      centro,
      DIAS_INVENTARIO.cuentaCorriente,
      IMPORTES,
    );
    const particular = await crearOferta(api, centro);
    await fijarPrecio(api, centro, particular, PARTICULAR);
    const { slots } = await diaDeTrabajo(
      api,
      centro,
      particular.id,
      DIAS_INVENTARIO.cuentaCorriente,
    );
    const turno = await reservarElPrimeroLibre(api, centro, particular.id, persona.id, slots);
    await cerrarSesionDelTurno(profesional, centro, turno.id);

    const deudas = await api.exigir<DeudaConConvenio[]>(
      'GET',
      `/api/v1/consultorios/${centro.consultorioId}/obligaciones?personaId=${persona.id}`,
    );
    expect(deudas.map((d) => d.concepto).sort()).toEqual(['COSEGURO', 'PARTICULAR']);
    const coseguro = deudas.find((d) => d.concepto === 'COSEGURO')!;
    const convenio = coseguro.convenio?.convenioNombre;
    expect(convenio, 'el coseguro lleva el convenio del que salio').toBeTruthy();
    expect(deudas.find((d) => d.concepto === 'PARTICULAR')?.convenio ?? null).toBeNull();

    // --- La pantalla ------------------------------------------------------------------------
    await ingresar(page, centro);
    await navegar(page, `/pacientes/${persona.id}/cuenta-corriente`);
    const tabla = page.getByRole('region', { name: 'Deudas de la persona' });
    const filaCoseguro = tabla.getByRole('row').filter({ hasText: 'Coseguro' });
    await expect(filaCoseguro).toContainText(`Convenio ${convenio}`);
    await expect(filaCoseguro).toContainText(pesos(IMPORTES.coseguro));
    await expect(filaCoseguro).not.toContainText('Revisar:');

    const filaParticular = tabla.getByRole('row').filter({ hasText: 'Particular' });
    await expect(filaParticular).toContainText(pesos(PARTICULAR));
    await expect(filaParticular).not.toContainText('Convenio');
    // La deuda del financiador no es de la persona: no aparece en su cuenta.
    await expect(tabla.getByText('A cargo de la obra social')).toHaveCount(0);
  });
});
