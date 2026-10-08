import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { Agenda } from '../../../../api/generated/model/agenda';
import { DiaDeAgenda } from '../../../../api/generated/model/dia-de-agenda';
import { OfertaResponse } from '../../../../api/generated/model/oferta-response';
import { PERMISO_TURNO_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { ProfesionalHabilitado } from '../../../../api/generated/model/profesional-habilitado';
import { SlotDisponible } from '../../../../api/generated/model/slot-disponible';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { SchedulingApi } from '../../services/scheduling-api';
import { recortarVentana, traducirErrorAgenda } from '../../models/agenda-errors';
import {
  diaSinSlots,
  fechaEnPalabras,
  hoy,
  rangoEnZona,
  slotCompleto,
  sumarDias,
  textoDeCupo,
  textoSinSlots,
} from '../../models/etiquetas-de-agenda';

/** Ventana por defecto: una semana. `hasta` es exclusivo. */
const DIAS_POR_DEFECTO = 7;

/**
 * El buscador de agenda (M12, AKINE-05.01).
 *
 * <p>Es la pantalla con la que el mostrador contesta "¿cuando lo puedo atender?". Elegis una
 * oferta, un rango de fechas y —si querés— un profesional, y ves dia por dia que huecos hay.
 *
 * <h2>1. Ningun dia de la ventana se omite</h2>
 *
 * <p>Es la decision que sostiene toda la pantalla. Un dia sin turnos <b>no se saltea</b>: se
 * dibuja con el motivo que el backend manda, y los nueve motivos tienen texto propio. Saltearlo
 * dejaria al operador frente a un salto de fechas indistinguible de un error del sistema, y un
 * "no hay turnos" generico no le dice si tiene que cargar un horario, habilitar un profesional o
 * simplemente probar otro dia.
 *
 * <h2>2. Un slot completo se muestra, no se esconde</h2>
 *
 * <p>Por lo mismo. Un hueco en la grilla el usuario lo lee como "no atiende a esa hora", que es
 * una afirmacion distinta de "a esa hora atiende y ya se lleno". El slot lleno se dibuja
 * deshabilitado y con la palabra completo.
 *
 * <h2>3. La ventana se recorta sola</h2>
 *
 * <p>El backend acepta 62 dias y responde 400 `ventana-demasiado-amplia` con `maxDays`. Con ese
 * numero la pantalla <b>recorta y reintenta</b> en vez de mostrar un cartel: el usuario pidio un
 * rango grande, no cometio un error. Se le avisa que se recorto, que es distinto de fallar.
 *
 * <h2>4. Los instantes son UTC y la sede puede estar en otro huso</h2>
 *
 * <p>`timezone` viaja en la respuesta y la pantalla lo <b>rotula</b>. Formatear con la zona del
 * navegador mostraria horarios corridos sin que nada falle, que es el peor tipo de bug de agenda:
 * silencioso y con consecuencias en la vida real de un paciente.
 *
 * <h2>5. Reservar es otra pantalla</h2>
 *
 * <p>Elegir el slot navega a la reserva, que es donde se elige la persona y se confirma. No se
 * reserva desde la grilla: sin resumen previo, un click de mas crea un turno.
 *
 * <p><b>No hay cancelar.</b> AKINE-05.03 quedo fuera de alcance por DP-10 y el endpoint no
 * existe: un boton que promete algo que termina en 404 es peor que su ausencia.
 */
@Component({
  selector: 'app-buscador-de-agenda-page',
  imports: [RouterLink],
  templateUrl: './buscador-de-agenda-page.html',
  styleUrl: '../../agenda.css',
})
export class BuscadorDeAgendaPage {
  private readonly api = inject(SchedulingApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly router = inject(Router);

  private readonly permisos = inject(PermissionsStore);

  /**
   * Verdadero si el contexto activo puede reservar.
   *
   * <p>Es UX y no seguridad: el backend rechaza igual. Se usa para decidir si el slot es un boton
   * o un texto, <b>nunca</b> para esconderlo.
   */
  protected readonly puedeReservar = computed(() => this.permisos.tiene(PERMISO_TURNO_MANAGE));
  protected readonly diaSinSlots = diaSinSlots;
  protected readonly fechaEnPalabras = fechaEnPalabras;
  protected readonly slotCompleto = slotCompleto;
  protected readonly textoDeCupo = textoDeCupo;
  protected readonly textoSinSlots = textoSinSlots;

  protected readonly ofertas = signal<readonly OfertaResponse[]>([]);
  protected readonly profesionales = signal<readonly ProfesionalHabilitado[]>([]);

  protected readonly ofertaId = signal<number | null>(null);
  protected readonly profesionalId = signal<number | null>(null);
  protected readonly desde = signal(hoy());
  protected readonly hasta = signal(sumarDias(hoy(), DIAS_POR_DEFECTO));

  /**
   * La consulta de agenda en vuelo. Cada consulta nueva cancela la anterior: sin esto gana la
   * respuesta que llega ULTIMA y no la del pedido mas nuevo, y la ventana mas ancha —la que tarda
   * mas— pisaba la grilla de la que el usuario acababa de pedir. Lo destapo el E2E contra el
   * backend real (AKINE E-2).
   */
  private consultaEnVuelo: Subscription | null = null;

  protected readonly agenda = signal<Agenda | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly faltaContexto = signal(false);
  /** Aviso de que la ventana se recorto sola. No es un error: la consulta se hizo igual. */
  protected readonly avisoDeRecorte = signal<string | null>(null);

  protected readonly dias = computed<readonly DiaDeAgenda[]>(() => this.agenda()?.dias ?? []);
  protected readonly timezone = computed(() => this.agenda()?.timezone ?? '');
  protected readonly duracion = computed(() => this.agenda()?.duracionMinutos ?? 0);

  /** `true` cuando toda la ventana quedo sin un solo slot: el resumen lo dice arriba. */
  protected readonly ventanaVacia = computed(
    () => this.dias().length > 0 && this.dias().every((dia) => diaSinSlots(dia)),
  );

  constructor() {
    effect(() => {
      // Cambiar de organizacion o de sede invalida todo: las ofertas, las habilitaciones y la
      // grilla son de la sede anterior. Dejarlas en pantalla es la fuga de tenant.
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.ofertas.set([]);
        this.profesionales.set([]);
        this.ofertaId.set(null);
        this.profesionalId.set(null);
        this.agenda.set(null);
        this.limpiarAvisos();
        this.cargarOfertas();
      });
    });
  }

  protected rango(slot: SlotDisponible): string {
    return rangoEnZona(slot, this.timezone());
  }

  // -------------------------------------------------------------------------------------
  // Ofertas y profesionales
  // -------------------------------------------------------------------------------------

  private cargarOfertas(): void {
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      this.faltaContexto.set(true);
      this.error.set(
        'Para ver la agenda hay que tener un consultorio elegido: la agenda es de una sede.',
      );
      return;
    }

    this.api.ofertasAgendables(consultorioId).subscribe({
      next: (ofertas) => this.ofertas.set(ofertas),
      error: (error: unknown) => this.mostrarError(error),
    });
  }

  protected elegirOferta(valor: string): void {
    const id = Number(valor);
    this.profesionalId.set(null);
    this.profesionales.set([]);
    this.agenda.set(null);
    this.limpiarAvisos();

    if (!Number.isFinite(id) || id <= 0) {
      this.ofertaId.set(null);
      return;
    }

    this.ofertaId.set(id);
    const consultorioId = this.tenantContext.consultorioId();
    if (consultorioId === null) {
      return;
    }

    this.api.habilitaciones(consultorioId, id).subscribe({
      // Solo los que hoy pueden prestar la oferta: ofrecer un profesional cuya habilitacion
      // esta de baja es prometer una busqueda que siempre devuelve dias vacios.
      next: (respuesta) =>
        this.profesionales.set(
          (respuesta.profesionales ?? []).filter((p) => p.vigenteHoy === true),
        ),
      error: () => this.profesionales.set([]),
    });

    this.buscar();
  }

  protected elegirProfesional(valor: string): void {
    const id = Number(valor);
    this.profesionalId.set(Number.isFinite(id) && id > 0 ? id : null);
    this.buscar();
  }

  /**
   * Cambiar el rango descarta el aviso de recorte antes de volver a consultar.
   *
   * <p>El aviso habla de <b>una</b> ventana: la que el backend rechazo por ancha. Dejarlo dibujado
   * sobre la consulta siguiente afirma que esa tambien se recorto, y el usuario no tiene como
   * saber cual de las dos describe. No se limpia dentro de {@link buscar} porque el reintento
   * automatico pasa por ahi <b>despues</b> de poner el aviso, y lo borraria en el acto.
   */
  protected cambiarDesde(valor: string): void {
    this.avisoDeRecorte.set(null);
    this.desde.set(valor);
    this.buscar();
  }

  protected cambiarHasta(valor: string): void {
    this.avisoDeRecorte.set(null);
    this.hasta.set(valor);
    this.buscar();
  }

  // -------------------------------------------------------------------------------------
  // La consulta
  // -------------------------------------------------------------------------------------

  protected buscar(): void {
    const consultorioId = this.tenantContext.consultorioId();
    const ofertaId = this.ofertaId();
    if (consultorioId === null || ofertaId === null) {
      return;
    }

    this.cargando.set(true);
    this.error.set(null);
    this.faltaContexto.set(false);

    this.consultaEnVuelo?.unsubscribe();
    this.consultaEnVuelo = this.api
      .buscarAgenda(consultorioId, ofertaId, {
        desde: this.desde(),
        hasta: this.hasta(),
        profesionalId: this.profesionalId() ?? undefined,
      })
      .subscribe({
        next: (agenda) => {
          this.agenda.set(agenda);
          this.cargando.set(false);
        },
        error: (error: unknown) => {
          this.cargando.set(false);
          const traducido = traducirErrorAgenda(error);

          // El unico error que la pantalla resuelve sola: el backend dijo cuanto acepta, asi que
          // se recorta y se vuelve a pedir. Sin `maxDays` no hay nada que recortar y se muestra.
          if (traducido.causa === 'ventana-demasiado-amplia') {
            const recortada = recortarVentana(this.desde(), traducido.maxDias);
            if (recortada !== null && recortada !== this.hasta()) {
              this.hasta.set(recortada);
              this.avisoDeRecorte.set(traducido.mensaje);
              this.buscar();
              return;
            }
          }

          this.agenda.set(null);
          this.error.set(traducido.mensaje);
          this.faltaContexto.set(traducido.causa === 'sin-contexto');
        },
      });
  }

  /** Navega a la reserva con todo lo que esa pantalla necesita para rearmar el resumen. */
  protected reservar(dia: DiaDeAgenda, slot: SlotDisponible): void {
    const ofertaId = this.ofertaId();
    if (ofertaId === null || slot.desde === undefined) {
      return;
    }

    this.router
      .navigate(['/agenda', 'ofertas', ofertaId, 'reservar'], {
        queryParams: {
          fecha: dia.fecha,
          inicio: slot.desde,
          // El del slot y no el del filtro: sin filtro la grilla trae los de todos los
          // profesionales, y el que atiende ese hueco es el que el slot declara.
          profesionalId: slot.profesionalId ?? undefined,
        },
      })
      .catch((error: unknown) => {
        console.error('No se pudo abrir la pantalla de reserva', error);
        this.error.set('No pudimos abrir la pantalla de reserva. Volve a intentar.');
      });
  }

  private limpiarAvisos(): void {
    this.error.set(null);
    this.faltaContexto.set(false);
    this.avisoDeRecorte.set(null);
  }

  private mostrarError(error: unknown): void {
    const traducido = traducirErrorAgenda(error);
    this.error.set(traducido.mensaje);
    this.faltaContexto.set(traducido.causa === 'sin-contexto');
  }
}
