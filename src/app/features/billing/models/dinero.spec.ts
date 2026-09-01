import { aCentavos, centavosDeTexto, deCentavos, sumaDeCentavos, textoDeCentavos } from './dinero';

/**
 * Spec de la aritmetica de plata (M19, AKINE-07.02).
 *
 * <p>Cubre <b>lo unico que decide comportamiento</b>: que sumar dinero en esta pantalla no pase
 * nunca por un flotante. Si esto se rompe, el sintoma no es un error visible: es un cobro valido
 * que la pantalla bloquea, o un cuerpo descuadrado que el control local deja pasar y el servidor
 * rechaza con 400 delante del paciente.
 */
describe('dinero', () => {
  it('la suma que rompe el punto flotante da exacto en centavos', () => {
    // El caso canonico: 0.1 + 0.2 === 0.30000000000000004. Con `number`, un cobro de $0,30 pagado
    // con dos medios de $0,10 y $0,20 se compararia como distinto del total y quedaria bloqueado.
    const medios = [centavosDeTexto('0,10'), centavosDeTexto('0.20')] as number[];

    expect(sumaDeCentavos(medios)).toBe(30);
    expect(sumaDeCentavos(medios)).toBe(centavosDeTexto('0,30'));
  });

  it('parsea desde el TEXTO, que es donde el flotante todavia no rompio nada', () => {
    // `Number('0.29') * 100` da 28.999999999999996: el valor ya se perdio antes de sumar.
    expect(centavosDeTexto('0.29')).toBe(29);
    expect(centavosDeTexto('8500,50')).toBe(850050);
    // Un decimal solo se completa a la derecha: 8,5 son ocho cincuenta y no ocho con cinco.
    expect(centavosDeTexto('8,5')).toBe(850);
    expect(centavosDeTexto('8500')).toBe(850000);
    // Coma y punto valen los dos: rechazar uno produce "tu importe no es un numero" sobre un
    // importe que el operador escribio bien.
    expect(centavosDeTexto('1.05')).toBe(centavosDeTexto('1,05'));
  });

  it('lo que no es un importe da null y no un cero que se sumaria en silencio', () => {
    expect(centavosDeTexto('')).toBeNull();
    expect(centavosDeTexto('   ')).toBeNull();
    expect(centavosDeTexto('ocho mil')).toBeNull();
    expect(centavosDeTexto('-50')).toBeNull();
    // Tres decimales no son centavos: aceptarlos redondearia plata sin decirlo.
    expect(centavosDeTexto('1.005')).toBeNull();
    expect(centavosDeTexto('1e3')).toBeNull();
    expect(centavosDeTexto('9999999999')).toBeNull();
  });

  it('convierte los importes del contrato sin perder el centavo', () => {
    // 8500.5 * 100 no da 850050 exacto en binario; el redondeo al centavo lo recupera.
    expect(aCentavos(8500.5)).toBe(850050);
    expect(aCentavos(8.32)).toBe(832);
    expect(aCentavos(0)).toBe(0);
    expect(aCentavos(undefined)).toBeNull();
    expect(aCentavos(Number.NaN)).toBeNull();
  });

  it('vuelve a decimal solo al final, y el ida y vuelta no mueve el valor', () => {
    expect(deCentavos(850050)).toBe(8500.5);
    expect(deCentavos(centavosDeTexto('0,30') as number)).toBe(0.3);
  });

  it('escribe el importe como el propio parser lo vuelve a leer', () => {
    expect(textoDeCentavos(850050)).toBe('8500.50');
    expect(textoDeCentavos(5)).toBe('0.05');
    expect(textoDeCentavos(0)).toBe('0.00');
    expect(textoDeCentavos(-5)).toBe('-0.05');
    expect(centavosDeTexto(textoDeCentavos(850050))).toBe(850050);
  });
});
