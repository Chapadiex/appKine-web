import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { catchError, map, of } from 'rxjs';

import { CatalogoClinicoService } from '../../../../api/generated/api/catalogo-clinico.service';
import { CatalogoConceptoResponse } from '../../../../api/generated/model/catalogo-concepto-response';
import { CatalogoSolicitudResponse } from '../../../../api/generated/model/catalogo-solicitud-response';
import {
  ResolveCatalogoSolicitudRequest,
  ResolveCatalogoSolicitudRequestEstadoEnum,
} from '../../../../api/generated/model/resolve-catalogo-solicitud-request';
import { formatearInstante } from '../../../../shared/utils/instantes';
import { textoRequerido } from '../../../../shared/validators/texto-requerido';
import { CausaSolicitud, traducirErrorSolicitud } from '../../models/solicitud-errors';

type FiltroEstado = 'TODAS' | 'PENDIENTE' | 'APROBADA' | 'RECHAZADA';
type Desenlace = 'APROBAR' | 'RECHAZAR';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error'; readonly mensaje: string }
  | { readonly tipo: 'listo'; readonly solicitudes: readonly CatalogoSolicitudResponse[] };

/** Especialidades globales para colgar una practica, o por que no se pudieron leer. */
type Especialidades =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'listo'; readonly opciones: readonly CatalogoConceptoResponse[] };

/**
 * Bandeja de solicitudes al catalogo comun, para la administracion de plataforma (AKINE-A-7,
 * RF-M06-005).
 *
 * <p>El centro propone y la plataforma dispone. <b>Aprobar publica</b> el concepto global en la
 * misma transaccion que resuelve la solicitud, con el codigo, el nombre y la descripcion que la
 * plataforma deja en el formulario —precargados con lo propuesto, porque casi siempre alcanza—.
 * Una practica necesita ademas su especialidad global.
 *
 * <p><b>El 409 de duplicado no resuelve nada.</b> Si el codigo o el nombre ya estan en el
 * catalogo comun, la solicitud <b>sigue pendiente</b> y la pantalla lo dice en el campo que
 * choco: o se normaliza distinto, o se rechaza con una nota que diga que ya existe.
 *
 * <p><b>Sin contexto de tenant.</b> La bandeja es de todos los centros y el backend se la
 * entrega a la cuenta de plataforma con su token `pre_context`. Por eso esta pantalla no mira
 * `contextEpoch`: no hay centro que cambiar.
 */
@Component({
  selector: 'app-solicitudes-catalogo-page',
  imports: [ReactiveFormsModule],
  templateUrl: './solicitudes-catalogo-page.html',
})
export class SolicitudesCatalogoPage {
  private readonly catalogo = inject(CatalogoClinicoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly formBuilder = inject(FormBuilder);
  private readonly injector = inject(Injector);

  protected readonly formatearInstante = formatearInstante;

  protected readonly estado = signal<Estado>({ tipo: 'cargando' });
  protected readonly filtroEstado = signal<FiltroEstado>('PENDIENTE');
  protected readonly seleccionada = signal<CatalogoSolicitudResponse | null>(null);
  protected readonly desenlace = signal<Desenlace | null>(null);
  protected readonly especialidades = signal<Especialidades>({ tipo: 'cargando' });

  protected readonly enviando = signal(false);
  protected readonly intentos = signal(0);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaSolicitud | null>(null);
  /** Mensaje de la bandeja: el resultado de la ultima resolucion, o por que se recargo. */
  protected readonly aviso = signal<{ readonly ok: boolean; readonly texto: string } | null>(null);

  protected readonly solicitudes = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.solicitudes : [];
  });

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly opcionesDeEspecialidad = computed(() => {
    const actual = this.especialidades();
    return actual.tipo === 'listo' ? actual.opciones : [];
  });

  protected readonly esPractica = computed(() => this.seleccionada()?.tipo === 'PRACTICA');

  protected readonly formulario = this.formBuilder.nonNullable.group({
    codigo: [''],
    nombre: [''],
    descripcion: [''],
    especialidadId: [''],
    nota: ['', [textoRequerido]],
  });

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    this.estado.set({ tipo: 'cargando' });
    const filtro = this.filtroEstado();

    this.catalogo
      .listCatalogoSolicitudes({ estado: filtro === 'TODAS' ? undefined : filtro })
      .subscribe({
        next: (solicitudes) => this.estado.set({ tipo: 'listo', solicitudes }),
        error: (error: unknown) =>
          this.estado.set({ tipo: 'error', mensaje: traducirErrorSolicitud(error).mensaje }),
      });
  }

  protected cambiarFiltro(valor: string): void {
    const elegido: FiltroEstado =
      valor === 'TODAS' || valor === 'APROBADA' || valor === 'RECHAZADA' ? valor : 'PENDIENTE';
    this.cerrar();
    this.aviso.set(null);
    this.filtroEstado.set(elegido);
    this.cargar();
  }

  protected revisar(solicitud: CatalogoSolicitudResponse): void {
    this.aviso.set(null);
    this.seleccionada.set(solicitud);
    this.elegirDesenlace(null);
    afterNextRender(() => this.enfocar('#titulo-detalle-solicitud'), { injector: this.injector });
  }

  protected cerrar(): void {
    this.seleccionada.set(null);
    this.elegirDesenlace(null);
  }

  /**
   * Abre el formulario del desenlace. Aprobar precarga lo propuesto: la plataforma solo escribe
   * cuando normaliza.
   */
  protected elegirDesenlace(desenlace: Desenlace | null): void {
    const solicitud = this.seleccionada();
    this.desenlace.set(desenlace);
    this.enviando.set(false);
    this.intentos.set(0);
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.formulario.reset({
      codigo: solicitud?.codigoPropuesto ?? '',
      nombre: solicitud?.nombrePropuesto ?? '',
      descripcion: '',
      especialidadId: '',
      nota: '',
    });

    if (desenlace === 'APROBAR' && this.esPractica()) {
      this.cargarEspecialidades();
    }
    if (desenlace !== null) {
      afterNextRender(
        () => this.enfocar(desenlace === 'APROBAR' ? '#resolucion-codigo' : '#resolucion-nota'),
        { injector: this.injector },
      );
    }
  }

  protected mostrarError(campo: 'nota' | 'nombre' | 'especialidadId'): boolean {
    if (this.intentos() === 0) {
      return false;
    }
    const valores = this.formulario.getRawValue();
    switch (campo) {
      case 'nota':
        return this.formulario.controls.nota.invalid;
      case 'nombre':
        return this.desenlace() === 'APROBAR' && valores.nombre.trim() === '';
      case 'especialidadId':
        return this.desenlace() === 'APROBAR' && this.esPractica() && valores.especialidadId === '';
    }
  }

  protected enviar(): void {
    const solicitud = this.seleccionada();
    const desenlace = this.desenlace();
    if (this.enviando() || solicitud?.id === undefined || desenlace === null) {
      return;
    }

    this.intentos.update((valor) => valor + 1);
    const primero = (['nombre', 'especialidadId', 'nota'] as const).find((campo) =>
      this.mostrarError(campo),
    );
    if (primero !== undefined) {
      this.formulario.markAllAsTouched();
      this.enfocar(`#resolucion-${primero === 'especialidadId' ? 'especialidad' : primero}`);
      return;
    }

    const valores = this.formulario.getRawValue();
    const cuerpo: ResolveCatalogoSolicitudRequest = {
      estado:
        desenlace === 'APROBAR'
          ? ResolveCatalogoSolicitudRequestEstadoEnum.APROBADA
          : ResolveCatalogoSolicitudRequestEstadoEnum.RECHAZADA,
      nota: valores.nota.trim(),
      version: solicitud.version ?? 0,
    };
    if (desenlace === 'APROBAR') {
      // Un rechazo con datos de concepto es 400: solo se mandan al aprobar, y solo si hay algo.
      const codigo = valores.codigo.trim();
      const descripcion = valores.descripcion.trim();
      if (codigo !== '') {
        cuerpo.codigo = codigo;
      }
      cuerpo.nombre = valores.nombre.trim();
      if (descripcion !== '') {
        cuerpo.descripcion = descripcion;
      }
      if (this.esPractica()) {
        cuerpo.especialidadId = Number(valores.especialidadId);
      }
    }

    this.enviando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);

    this.catalogo
      .resolveCatalogoSolicitud({
        solicitudId: solicitud.id,
        resolveCatalogoSolicitudRequest: cuerpo,
      })
      .subscribe({
        next: (resuelta) => {
          this.cerrar();
          this.aviso.set({
            ok: true,
            texto:
              resuelta.estado === 'APROBADA'
                ? `Aprobada: "${cuerpo.nombre}" ya esta publicado en el catalogo comun` +
                  (resuelta.conceptoId === undefined ? '.' : ` (concepto ${resuelta.conceptoId}).`)
                : `Rechazada. El centro va a ver tu nota en sus pedidos.`,
          });
          this.cargar();
        },
        error: (error: unknown) => {
          const traducido = traducirErrorSolicitud(error);
          this.enviando.set(false);
          if (traducido.causa === 'ya-resuelta' || traducido.causa === 'no-encontrado') {
            // Lo que hay en pantalla quedo viejo: se descarta y se relee la bandeja.
            this.cerrar();
            this.aviso.set({ ok: false, texto: traducido.mensaje });
            this.cargar();
            return;
          }
          this.errorAccion.set(traducido.mensaje);
          this.causaAccion.set(traducido.causa);
        },
      });
  }

  protected etiquetaDeTipo(tipo: CatalogoSolicitudResponse['tipo']): string {
    switch (tipo) {
      case 'ESPECIALIDAD':
        return 'Especialidad';
      case 'PRACTICA':
        return 'Practica';
      case 'NOMENCLADOR':
        return 'Nomenclador';
      default:
        return 'Concepto';
    }
  }

  protected etiquetaDeEstado(estado: CatalogoSolicitudResponse['estado']): string {
    switch (estado) {
      case 'APROBADA':
        return 'Aprobada';
      case 'RECHAZADA':
        return 'Rechazada';
      default:
        return 'Pendiente';
    }
  }

  /**
   * Especialidades GLOBALES y vigentes: una practica publicada en el catalogo comun no puede
   * colgar de una especialidad de un centro (`catalogo-scope-mismatch`).
   */
  private cargarEspecialidades(): void {
    if (this.especialidades().tipo === 'listo') {
      return;
    }
    this.especialidades.set({ tipo: 'cargando' });
    this.catalogo
      .searchCatalogo({ tipo: 'especialidades', alcance: 'GLOBAL', estado: 'ACTIVO', size: 100 })
      .pipe(
        map((pagina): Especialidades => ({ tipo: 'listo', opciones: pagina.content ?? [] })),
        catchError(() => of<Especialidades>({ tipo: 'error' })),
      )
      .subscribe((resultado) => this.especialidades.set(resultado));
  }

  private enfocar(selector: string): void {
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
