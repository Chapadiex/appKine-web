import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { CasoAdministrativoResponse } from '../../../../api/generated/model/caso-administrativo-response';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { rotuloDeCaso } from '../../models/etiquetas-de-atencion';
import { ErrorAtencion, traducirErrorAtencion } from '../../models/atencion-errors';
import { ClinicalApi } from '../../services/clinical-api';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

import { Alerta } from '../../../../shared/components/alerta/alerta';

/**
 * Atender a un paciente sin turno (DP-43, U-24, RF-M14-002).
 *
 * <p><b>No es una reserva.</b> No ocupa ni libera agenda: Turno es reserva y Sesion es atencion
 * (DP-05). Por eso la pantalla vive en `clinical` y no en la agenda, y termina en la misma
 * pantalla de atencion que la de un turno.
 *
 * <p><b>Quien atiende es quien inicia.</b> El contrato no acepta otro profesional: el reemplazo es
 * una operacion aparte, del administrador de la sede.
 *
 * <p><b>El motivo es obligatorio</b> —sin turno nada explica por que el paciente estaba ahi— y el
 * caso lo es solo si la oferta lo exige (RF-M10-007).
 *
 * <p><b>`idempotencyKey`, una por intento.</b> Sin turno no hay reserva que ancle el doble click:
 * la clave hace que dos envios del mismo pedido devuelvan la misma atencion. Cambiar cualquier dato
 * es otro intento y descarta la clave; un 409 `idempotency-key-conflict` tambien.
 */
@Component({
  selector: 'app-atencion-sin-turno-page',
  imports: [CabeceraDePagina, Ayuda, RouterLink, Alerta],
  templateUrl: './atencion-sin-turno-page.html',
  styleUrl: '../../atencion.css',
})
export class AtencionSinTurnoPage {
  private readonly api = inject(ClinicalApi);
  private readonly router = inject(Router);
  private readonly tenantContext = inject(TenantContextStore);

  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
  protected readonly ofertaId = signal<number | null>(null);
  protected readonly candidatas = signal<readonly PersonaResponse[]>([]);
  protected readonly buscoPersonas = signal(false);
  protected readonly persona = signal<PersonaResponse | null>(null);
  protected readonly casos = signal<readonly CasoAdministrativoResponse[]>([]);
  protected readonly casoId = signal<number | null>(null);
  protected readonly motivo = signal('');
  protected readonly enviando = signal(false);
  /** Rechazo del servidor: arriba de "La atención", con un titulo que dice que fallo (UX-12). */
  protected readonly error = signal<ErrorAtencion | null>(null);
  protected readonly tituloDelError = signal('');
  /** Lo que falta para iniciar, y en que campo: se dice debajo de ese campo (UX-12). */
  protected readonly aviso = signal('');
  protected readonly campoDelAviso = signal<'persona' | 'oferta' | 'motivo' | 'caso' | null>(null);

  private claveDeIntento = '';

  protected readonly oferta = computed(
    () => this.ofertas().find((o) => o.id === this.ofertaId()) ?? null,
  );
  protected readonly requiereCaso = computed(() => this.oferta()?.requiereCasoClinico === true);

  constructor() {
    effect(() => {
      // Otra sede, otras ofertas y otro padron: nada de lo elegido sigue valiendo.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargarOfertas();
      });
    });
  }

  protected buscarPersona(texto: string): void {
    if (texto.trim() === '') {
      this.candidatas.set([]);
      this.buscoPersonas.set(false);
      return;
    }
    this.api.buscarPersonas(texto).subscribe({
      next: (personas) => {
        this.candidatas.set(personas);
        this.buscoPersonas.set(true);
      },
      error: (error: unknown) => this.fallar('No pudimos buscar en el padrón', error),
    });
  }

  protected elegirPersona(persona: PersonaResponse): void {
    this.persona.set(persona);
    this.candidatas.set([]);
    this.buscoPersonas.set(false);
    this.casos.set([]);
    this.casoId.set(null);
    this.otroIntento();
    if (persona.id !== undefined) {
      this.api.casosDePersona(persona.id).subscribe((casos) => this.casos.set(casos));
    }
  }

  protected elegirOferta(valor: string): void {
    const id = Number(valor);
    this.ofertaId.set(Number.isFinite(id) && id > 0 ? id : null);
    this.otroIntento();
  }

  protected elegirCaso(valor: string): void {
    const id = Number(valor);
    this.casoId.set(Number.isFinite(id) && id > 0 ? id : null);
    this.otroIntento();
  }

  protected escribirMotivo(valor: string): void {
    this.motivo.set(valor);
    this.otroIntento();
  }

  protected atender(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const personaId = this.persona()?.id;
    const ofertaId = this.ofertaId();
    const motivo = this.motivo().trim();
    const [campo, faltante]: readonly ['persona' | 'oferta' | 'motivo' | 'caso' | null, string] =
      personaId === undefined
        ? ['persona', 'Elegí a quien se atiende.']
        : ofertaId === null
          ? ['oferta', 'Elegí la oferta con la que se atiende.']
          : motivo === ''
            ? ['motivo', 'Escribi por que se atiende sin turno: es obligatorio.']
            : this.requiereCaso() && this.casoId() === null
              ? ['caso', 'Esta prestación exige un caso clínico: elegí uno.']
              : [null, ''];
    if (faltante !== '' || consultorioId === null || personaId === undefined || ofertaId === null) {
      this.aviso.set(faltante);
      this.campoDelAviso.set(campo);
      if (campo !== null) {
        // El boton esta al pie y el campo, arriba: el foco va a lo que hay que completar.
        setTimeout(() => document.getElementById(`sin-turno-${campo}`)?.focus());
      }
      return;
    }
    this.aviso.set('');
    this.campoDelAviso.set(null);
    this.error.set(null);
    this.enviando.set(true);
    this.api
      .iniciarSinTurno(consultorioId, {
        personaId,
        ofertaId,
        motivo,
        casoId: this.casoId() ?? undefined,
        idempotencyKey: this.clave(),
      })
      .subscribe({
        next: (sesion) => {
          this.enviando.set(false);
          this.router.navigate(['/atencion', 'sesiones', sesion.id]);
        },
        error: (error: unknown) => {
          this.enviando.set(false);
          const traducido = traducirErrorAtencion(error);
          this.tituloDelError.set('No pudimos iniciar la atención');
          this.error.set(traducido);
          if (traducido.causa === 'clave-reusada') {
            this.claveDeIntento = '';
          }
        },
      });
  }

  protected readonly rotuloDeCaso = rotuloDeCaso;

  private cargarOfertas(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }
    this.api.ofertasDeLaSede(consultorioId).subscribe({
      next: (ofertas) => this.ofertas.set(ofertas),
      error: (error: unknown) => this.fallar('No pudimos leer las ofertas de la sede', error),
    });
  }

  private reiniciar(): void {
    this.ofertas.set([]);
    this.ofertaId.set(null);
    this.candidatas.set([]);
    this.buscoPersonas.set(false);
    this.persona.set(null);
    this.casos.set([]);
    this.casoId.set(null);
    this.motivo.set('');
    this.error.set(null);
    this.aviso.set('');
    this.campoDelAviso.set(null);
    this.claveDeIntento = '';
  }

  private fallar(titulo: string, error: unknown): void {
    this.tituloDelError.set(titulo);
    this.error.set(traducirErrorAtencion(error));
  }

  /** Otro dato es otro pedido: la clave anterior chocaria con 409 `idempotency-key-conflict`. */
  private otroIntento(): void {
    this.claveDeIntento = '';
  }

  private clave(): string {
    if (this.claveDeIntento === '') {
      this.claveDeIntento =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `akine-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    return this.claveDeIntento;
  }
}
