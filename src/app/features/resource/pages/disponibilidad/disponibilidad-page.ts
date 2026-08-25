import { Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';

import { EspacioAvailabilityResponse } from '../../../../api/generated/model/espacio-availability-response';
import { EspaciosService } from '../../../../api/generated/api/espacios.service';
import { EstadoDeListado, vistaDeListado } from '../../../../shared/utils/estado-de-listado';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { etiquetaDeTipo } from '../../models/tipos-de-espacio';
import { traducirErrorEspacio } from '../../models/espacio-errors';
import { aCampoLocal, aInstanteUtc, formatearInstante } from '../../../../shared/utils/instantes';

/** Lo que devuelve la consulta, envuelto para reusar {@link vistaDeListado}. */
interface ResultadoDeVentana {
  readonly content: readonly EspacioAvailabilityResponse[];
}

/** Tope de la ventana que acepta el backend. Mas de eso es `400`. */
const MAXIMO_DE_DIAS = 31;

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Que espacios de la sede estan <b>en servicio</b> durante una ventana (M04, RF-M04-003).
 *
 * <h2>Lo que esta pantalla NO dice</h2>
 *
 * <p><b>No dice que un box este libre.</b> Esta consulta responde si el recurso esta en
 * servicio -activo y con su vigencia cubriendo el intervalo completo-, no si esta libre de
 * reservas. Los turnos y las inscripciones son de modulos que todavia no existen, asi que
 * `lugaresComprometidos` es <b>siempre 0</b> en el contrato 0.7.0 y `lugaresDisponibles` es
 * siempre igual a `capacidad`.
 *
 * <p>Por eso la tabla muestra <b>capacidad</b> y no ocupacion, y en ningun lado aparecen las
 * palabras "libre" o "disponible" aplicadas a un box. Cuando exista la agenda esos numeros van
 * a cambiar solos <b>sin que el contrato cambie</b>: un cartel que hoy dijera "3 lugares
 * libres" empezaria a mentir sin que nadie tocara esta pantalla, y nadie se enteraria hasta
 * que un paciente se quedara sin lugar. Mostrar solo lo que el dato hoy sostiene es lo unico
 * que no envejece mal.
 *
 * <h2>Arranca vacia, y a proposito</h2>
 *
 * <p>Usa el caso `inicial` de {@link EstadoDeListado}: sin ventana elegida la peticion seria
 * invalida -`desde` y `hasta` son obligatorios-, asi que consultar al entrar seria un `400`
 * garantizado en cada visita. La ventana se propone precargada con las proximas dos horas para
 * que el caso frecuente sea un solo click, pero la consulta la dispara el usuario.
 *
 * <p>El tope de 31 dias se valida <b>antes</b> de salir: el backend lo rechaza igual, pero
 * gastar un `400` para decir algo que ya se sabe deja al usuario sin saber cual de los dos
 * campos corregir.
 */
@Component({
  selector: 'app-disponibilidad-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './disponibilidad-page.html',
  styleUrl: '../../resource.css',
})
export class DisponibilidadPage {
  private readonly espacios = inject(EspaciosService);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly etiquetaDeTipo = etiquetaDeTipo;
  protected readonly formatearInstante = formatearInstante;
  protected readonly maximoDeDias = MAXIMO_DE_DIAS;

  protected readonly nombreDeLaSede = computed(
    () => this.tenantContext.context()?.consultorioName ?? 'la sede activa',
  );

  protected readonly estado = signal<EstadoDeListado<ResultadoDeVentana>>({ tipo: 'inicial' });

  private readonly vista = vistaDeListado<EspacioAvailabilityResponse>(this.estado);
  protected readonly enServicio = this.vista.filas;
  protected readonly mensajeError = this.vista.mensajeError;
  protected readonly faltaContexto = this.vista.faltaContexto;

  /** Error local de la ventana: ventana invertida o de mas de 31 dias. */
  protected readonly errorVentana = signal<string | null>(null);
  protected readonly intentos = signal(0);

  /** La ventana efectivamente consultada, para encabezar el resultado. */
  protected readonly ventanaConsultada = signal<{
    readonly desde: string;
    readonly hasta: string;
  } | null>(null);

  protected readonly formulario = inject(FormBuilder).nonNullable.group({
    desde: ['', [Validators.required]],
    hasta: ['', [Validators.required]],
  });

  protected readonly sinSede = computed(() => this.tenantContext.consultorioId() === null);

  constructor() {
    effect(() => {
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.estado.set({ tipo: 'inicial' });
        this.errorVentana.set(null);
        this.ventanaConsultada.set(null);
        this.intentos.set(0);
        this.proponerVentana();
      });
    });
  }

  /**
   * Precarga las proximas dos horas.
   *
   * <p>Es la pregunta que alguien de recepcion hace de verdad: "que box tengo ahora". Dejar los
   * dos campos vacios obligaria a escribir dos instantes completos para responderla.
   */
  private proponerVentana(): void {
    const ahora = new Date();
    const enDosHoras = new Date(ahora.getTime() + 2 * 60 * 60 * 1000);
    this.formulario.reset({
      desde: aCampoLocal(ahora.toISOString()),
      hasta: aCampoLocal(enDosHoras.toISOString()),
    });
  }

  protected mostrarError(campo: 'desde' | 'hasta'): boolean {
    const control = this.formulario.controls[campo];
    return control.invalid && (control.touched || this.intentos() > 0);
  }

  protected consultar(): void {
    this.intentos.update((valor) => valor + 1);
    this.errorVentana.set(null);

    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      this.enfocar(this.formulario.controls.desde.invalid ? '#ventana-desde' : '#ventana-hasta');
      return;
    }

    const valores = this.formulario.getRawValue();
    const desde = aInstanteUtc(valores.desde);
    const hasta = aInstanteUtc(valores.hasta);

    if (desde === null || hasta === null) {
      this.errorVentana.set('Revisa las dos fechas: alguna no es un momento valido.');
      this.enfocar('#ventana-desde');
      return;
    }

    const duracion = new Date(hasta).getTime() - new Date(desde).getTime();

    if (duracion <= 0) {
      this.errorVentana.set(
        'El fin de la ventana tiene que ser posterior al inicio. El fin es exclusivo, asi que ' +
          'una ventana que empieza y termina en el mismo instante no contiene ningun momento.',
      );
      this.enfocar('#ventana-hasta');
      return;
    }

    if (duracion > MAXIMO_DE_DIAS * MILISEGUNDOS_POR_DIA) {
      this.errorVentana.set(
        `La ventana no puede pasar de ${MAXIMO_DE_DIAS} dias. Consulta un mes por vez.`,
      );
      this.enfocar('#ventana-hasta');
      return;
    }

    const orgId = this.tenantContext.organizationId();
    const consultorioId = this.tenantContext.consultorioId();
    if (orgId === null || consultorioId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.ventanaConsultada.set({ desde, hasta });
    this.estado.set({ tipo: 'cargando' });

    this.espacios
      .checkEspaciosAvailability({ orgId, consultorioId, desde, hasta })
      .pipe(catchError((error: unknown) => of(error instanceof Error ? error : new Error(''))))
      .subscribe((respuesta) => {
        if (respuesta instanceof Error) {
          const traducido = traducirErrorEspacio(respuesta);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
          return;
        }
        this.estado.set({ tipo: 'listo', pagina: { content: respuesta } });
      });
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
