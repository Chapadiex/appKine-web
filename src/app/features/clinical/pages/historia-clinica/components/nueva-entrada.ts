import { Component, computed, inject, input, output, signal } from '@angular/core';

import { EntradaClinicaResponse } from '../../../../../api/generated/model/entrada-clinica-response';
import { RegistrarEntradaClinicaRequestTipoEnum } from '../../../../../api/generated/model/registrar-entrada-clinica-request';
import { ErrorHistoria, traducirErrorHistoria } from '../../../models/historia-errors';
import { TIPOS_DE_ENTRADA } from '../../../models/etiquetas-de-historia';
import { HistoriaClinicaApi, Justificacion } from '../../../services/historia-clinica-api';

/**
 * Registrar una entrada clinica (D-a, RF-M09-003).
 *
 * <p>La fecha del hecho la pone el servidor: es "ahora". Cargar una entrada con fecha pasada es un
 * caso que el contrato admite (`ocurrioEn`), pero ofrecerlo en el formulario por defecto invita a
 * reescribir la cronologia; queda para cuando haya un pedido concreto.
 */
@Component({
  selector: 'app-nueva-entrada',
  templateUrl: './nueva-entrada.html',
  styleUrl: '../historia-clinica.css',
})
export class NuevaEntrada {
  private readonly api = inject(HistoriaClinicaApi);

  readonly historiaClinicaId = input.required<number>();
  readonly justificacion = input.required<Justificacion>();

  readonly registrada = output<EntradaClinicaResponse>();

  protected readonly tipos = Object.entries(TIPOS_DE_ENTRADA) as [
    RegistrarEntradaClinicaRequestTipoEnum,
    string,
  ][];

  protected readonly tipo = signal<RegistrarEntradaClinicaRequestTipoEnum>(
    RegistrarEntradaClinicaRequestTipoEnum.EVOLUCION,
  );
  protected readonly cuerpo = signal('');
  protected readonly enviando = signal(false);
  protected readonly intentoEnviar = signal(false);
  protected readonly error = signal<ErrorHistoria | null>(null);
  protected readonly aviso = signal('');

  protected readonly faltaCuerpo = computed(() => this.cuerpo().trim() === '');

  protected elegirTipo(valor: string): void {
    this.tipo.set(valor as RegistrarEntradaClinicaRequestTipoEnum);
  }

  protected registrar(): void {
    this.intentoEnviar.set(true);
    if (this.faltaCuerpo() || this.enviando()) {
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    this.api
      .registrarEntrada(
        this.historiaClinicaId(),
        this.tipo(),
        this.cuerpo().trim(),
        this.justificacion(),
      )
      .subscribe({
        next: (entrada) => {
          this.enviando.set(false);
          this.intentoEnviar.set(false);
          this.cuerpo.set('');
          this.aviso.set('Entrada registrada. Ya aparece en el timeline.');
          this.registrada.emit(entrada);
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          this.error.set(traducirErrorHistoria(error));
        },
      });
  }
}
