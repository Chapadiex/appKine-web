import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Campo de importe: al salir completa los dos decimales (`1500` → `1500,00`, `8,5` → `8,50`).
 *
 * <p>Va con el envoltorio `.campo-importe` del design system, que pone el `$` fijo a la izquierda
 * (25/11/2026). Escribe el valor y dispara `input`, asi lo ven por igual un `formControlName` y un
 * `(input)` a mano. Lo que no es un importe queda como esta, para que el operador lo corrija.
 *
 * <p>En un `type="number"` usa punto (`1500.00`): el navegador no acepta coma en ese tipo y lo
 * muestra con el separador del idioma.
 */
@Directive({
  selector: 'input[appImporte]',
  host: { '(blur)': 'completar()' },
})
export class Importe {
  private readonly elemento = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

  protected completar(): void {
    const formateado = conDosDecimales(this.elemento.value, this.elemento.type === 'number');
    if (formateado === null || formateado === this.elemento.value) {
      return;
    }
    this.elemento.value = formateado;
    this.elemento.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

const IMPORTE = /^(\d{1,9})(?:[.,](\d{0,2}))?$/;

/** `1500` → `1500,00`; `null` si no es un importe. Exportada para probarla sin montar nada. */
export function conDosDecimales(texto: string, conPunto = false): string | null {
  const partes = IMPORTE.exec(texto.trim().replace(/\s/g, ''));
  if (partes === null) {
    return null;
  }
  return `${Number(partes[1])}${conPunto ? '.' : ','}${(partes[2] ?? '').padEnd(2, '0')}`;
}
