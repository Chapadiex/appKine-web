import { EsperaPorLimite } from './espera-por-limite';

describe('EsperaPorLimite', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('empieza inactiva', () => {
    const espera = new EsperaPorLimite();

    expect(espera.activa()).toBe(false);
    expect(espera.segundos()).toBe(0);
  });

  it('descuenta un segundo por segundo hasta llegar a cero', () => {
    const espera = new EsperaPorLimite();
    espera.iniciar(3);

    expect(espera.segundos()).toBe(3);

    vi.advanceTimersByTime(1000);
    expect(espera.segundos()).toBe(2);

    vi.advanceTimersByTime(2000);
    expect(espera.segundos()).toBe(0);
    expect(espera.activa()).toBe(false);
  });

  it('no sigue descontando despues de llegar a cero', () => {
    const espera = new EsperaPorLimite();
    espera.iniciar(1);

    vi.advanceTimersByTime(10_000);

    expect(espera.segundos()).toBe(0);
  });

  it('ignora una espera de cero o negativa', () => {
    const espera = new EsperaPorLimite();
    espera.iniciar(0);

    expect(espera.activa()).toBe(false);
  });

  it('detener corta la cuenta regresiva', () => {
    const espera = new EsperaPorLimite();
    espera.iniciar(5);
    espera.detener();

    vi.advanceTimersByTime(3000);

    expect(espera.segundos()).toBe(5);
  });

  it('reiniciar reemplaza la espera anterior en lugar de sumar temporizadores', () => {
    const espera = new EsperaPorLimite();
    espera.iniciar(5);
    espera.iniciar(2);

    vi.advanceTimersByTime(1000);

    expect(espera.segundos()).toBe(1);
  });
});
