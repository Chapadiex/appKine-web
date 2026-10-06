import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AdjuntoPageResponse } from '../../../../api/generated/model/adjunto-page-response';
import { AdjuntoResponse } from '../../../../api/generated/model/adjunto-response';
import { ConfirmacionConMotivo } from '../../../../shared/components/confirmacion-con-motivo/confirmacion-con-motivo';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { Paginacion } from '../../../../shared/components/paginacion/paginacion';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PersonApi } from '../../services/person-api';
import { PersonaResponse } from '../../../../api/generated/model/persona-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import {
  AdjuntosApi,
  CATEGORIAS_DE_ADJUNTO,
  CategoriaDeAdjunto,
  FiltroDeAdjuntos,
} from '../../services/adjuntos-api';
import { CausaPersona, hayQueRecargar, traducirErrorPersona } from '../../models/person-errors';
import { nombreCompleto, personaInactiva } from '../../models/etiquetas-de-person';
import {
  adjuntoInactivo,
  adjuntoNoDisponible,
  esCategoria,
  fechaEnPalabras,
  nombreDeAdjunto,
  nombreDeCategoria,
  tamanoEnPalabras,
} from '../../models/etiquetas-de-ficha';
import { nombreDeContentDisposition } from '../../../../shared/utils/archivos';

const TAMANO_DE_PAGINA = 20;

/** Operacion abierta sobre una fila. Solo una a la vez. */
type TipoAccion = 'reclasificar' | 'baja';

/**
 * Documentacion administrativa de una persona (M25, RF-M25-001..005, AKINE-03.02).
 *
 * <p>Es donde el mostrador carga el DNI escaneado, la credencial de la obra social, el
 * consentimiento firmado y el comprobante que trajo el paciente. Nada mas que eso.
 *
 * <h2>1. Ninguna categoria es clinica, y eso no es un recorte de esta pantalla</h2>
 *
 * <p>Las seis categorias del contrato son todas administrativas (RN-M25-005) y un `CHECK` de la
 * base lo hace cumplir: un estudio, una radiografia o un informe viven en M09 con sus propios
 * controles de acceso. La pantalla lo dice arriba de todo, porque el reflejo de quien tiene un PDF
 * en la mano es subirlo donde haya un boton de subir, y este no es el lugar.
 *
 * <h2>2. Un adjunto NO reemplaza un dato estructurado (RN-M25-004)</h2>
 *
 * <p>Cargar la foto de una credencial <b>no carga la cobertura</b>, y subir el DNI escaneado
 * <b>no completa</b> el documento de la ficha. Es la confusion mas cara del modulo: el operador
 * cree que dejo el dato cargado, y despues la cobertura no aparece en ningun lado porque nunca se
 * cargo. Por eso el aviso esta al lado del formulario de subida y no en la ayuda de la pantalla.
 *
 * <h2>3. Lo unico editable es como esta descripto</h2>
 *
 * <p>El contenido, su nombre y su tipo son inmutables: reemplazar el archivo de una fila
 * reescribiria un hecho. Reemplazar un documento es dar de baja el viejo y subir el nuevo, lo que
 * deja las dos versiones consultables — y la pantalla lo dice asi, en vez de ofrecer un
 * "reemplazar" que no existe.
 *
 * <h2>4. La subida es idempotente, y por eso no hay candado contra el doble click</h2>
 *
 * <p>Subir dos veces el mismo archivo a la misma persona devuelve 200 con el adjunto que ya
 * existe, no 201 y no 409. Es la operacion mas expuesta a reintentos del producto —mostrador,
 * varios MB, timeouts— y el backend la resolvio ahi. La pantalla deshabilita el boton mientras hay
 * un envio en vuelo por cortesia visual, no para proteger un invariante.
 *
 * <h2>5. La descarga pasa por la aplicacion, y no hay ninguna URL para copiar</h2>
 *
 * <p>No existe ninguna URL firmada ni ninguna ruta interna (RN-M25-002): el contenido se pide con
 * una peticion autenticada y el backend autoriza <b>cada</b> llamada. El navegador recibe un
 * `Blob` y esta pantalla arma un enlace efimero para guardarlo, que se revoca enseguida. Un
 * `objectURL` que no se revoca deja el archivo entero retenido en memoria toda la sesion, y en una
 * pantalla de mostrador que descarga veinte estudios eso se nota.
 *
 * <p>Se descarga <b>aunque el documento o la persona esten dados de baja</b>: una baja logica dice
 * "esto ya no corresponde para operar", no "esto nunca existio".
 *
 * <h2>6. El caso que rompe la pantalla</h2>
 *
 * <p>Una persona dada de baja. No admite documentos nuevos —409 `persona-inactiva`— pero los que
 * ya tiene se siguen listando y descargando. La pantalla esconde el formulario de subida en vez de
 * dejar que el operador cargue un archivo de 8 MB para recibir el rechazo al final.
 */
@Component({
  selector: 'app-documentos-de-persona-page',
  imports: [ReactiveFormsModule, RouterLink, ConfirmacionConMotivo, Paginacion, PermisoDirective],
  templateUrl: './documentos-de-persona-page.html',
  styleUrl: '../../person.css',
})
export class DocumentosDePersonaPage {
  private readonly api = inject(AdjuntosApi);
  private readonly personas = inject(PersonApi);
  private readonly tenantContext = inject(TenantContextStore);
  private readonly formBuilder = inject(FormBuilder);

  readonly personaId = input.required<string>();

  protected readonly permisoManage = PERMISO_PACIENTE_MANAGE;
  protected readonly categorias = CATEGORIAS_DE_ADJUNTO;

  protected readonly nombreCompleto = nombreCompleto;
  protected readonly personaInactiva = personaInactiva;
  protected readonly nombreDeAdjunto = nombreDeAdjunto;
  protected readonly nombreDeCategoria = nombreDeCategoria;
  protected readonly adjuntoInactivo = adjuntoInactivo;
  protected readonly adjuntoNoDisponible = adjuntoNoDisponible;
  protected readonly tamanoEnPalabras = tamanoEnPalabras;
  protected readonly fechaEnPalabras = fechaEnPalabras;

  protected readonly estado = signal<EstadoDeListado<AdjuntoPageResponse>>({ tipo: 'cargando' });
  protected readonly persona = signal<PersonaResponse | null>(null);

  protected readonly filtroCategoria = signal<CategoriaDeAdjunto | ''>('');
  protected readonly filtro = signal<FiltroDeAdjuntos>('VIGENTES');
  protected readonly pagina = signal(0);

  protected readonly panel = signal<{ readonly id: number; readonly tipo: TipoAccion } | null>(
    null,
  );
  protected readonly subidaAbierta = signal(false);

  /** Archivo elegido en el formulario. Vive fuera del `FormGroup`: un input de archivo no se ata. */
  protected readonly archivo = signal<File | null>(null);

  protected readonly enviando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaPersona | null>(null);
  protected readonly exito = signal<string | null>(null);

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  protected readonly adjuntos = computed<readonly AdjuntoResponse[]>(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? (actual.pagina.content ?? []) : [];
  });

  protected readonly totalPaginas = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? (actual.pagina.totalPages ?? 0) : 0;
  });

  protected readonly totalDocumentos = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? (actual.pagina.totalElements ?? 0) : 0;
  });

  protected readonly cargando = computed(() => this.estado().tipo === 'cargando');

  protected readonly mensajeError = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  protected readonly faltaContexto = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' && actual.faltaContexto;
  });

  /** `true` cuando la ficha esta dada de baja: se lee y no admite documentos nuevos. */
  protected readonly fichaCerrada = computed(() => {
    const ficha = this.persona();
    return ficha !== null && personaInactiva(ficha);
  });

  protected readonly rutaFicha = computed(() => `/pacientes/${this.personaId()}` as const);

  protected readonly formularioSubida = this.formBuilder.nonNullable.group({
    // La categoria es obligatoria en el contrato y no tiene default: elegir por el operador
    // significaria clasificar mal por comodidad, y una credencial archivada como "OTRO" es una
    // credencial que despues nadie encuentra.
    categoria: ['', [Validators.required]],
    titulo: [''],
  });

  protected readonly formularioClasificacion = this.formBuilder.nonNullable.group({
    categoria: ['', [Validators.required]],
    titulo: [''],
  });

  constructor() {
    effect(() => {
      this.personaId();
      this.tenantContext.contextEpoch();
      untracked(() => {
        this.reiniciar();
        this.cargarFicha();
        this.cargar();
      });
    });
  }

  // -------------------------------------------------------------------------------------
  // Carga
  // -------------------------------------------------------------------------------------

  /**
   * La ficha, solo para el encabezado y para saber si admite documentos nuevos.
   *
   * <p>Su fallo <b>no rompe la pantalla</b>: el listado de documentos es lo que se vino a ver, y
   * quedarse sin el nombre de la persona es peor que no ver nada solo si uno confunde el titulo
   * con el contenido. Si no resuelve, el formulario de subida se muestra igual y el backend
   * rechaza si corresponde.
   */
  private cargarFicha(): void {
    const id = this.identificador();
    if (id === null) {
      return;
    }
    this.personas.ver(id).subscribe({
      next: (ficha) => this.persona.set(ficha),
      error: () => this.persona.set(null),
    });
  }

  protected cargar(): void {
    const id = this.identificador();
    if (id === null) {
      this.estado.set({
        tipo: 'error',
        mensaje: 'La direccion no identifica a ninguna persona del padron.',
        faltaContexto: false,
      });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    const categoria = this.filtroCategoria();
    this.api
      .listar({
        personaId: id,
        categoria: categoria === '' ? undefined : categoria,
        filtro: this.filtro(),
        pagina: this.pagina(),
        tamano: TAMANO_DE_PAGINA,
      })
      .subscribe({
        next: (pagina) => this.estado.set({ tipo: 'listo', pagina }),
        error: (error: unknown) => {
          const traducido = traducirErrorPersona(error);
          this.estado.set({
            tipo: 'error',
            mensaje: traducido.mensaje,
            faltaContexto: traducido.causa === 'sin-contexto',
          });
        },
      });
  }

  protected cambiarCategoria(valor: string): void {
    this.filtroCategoria.set(esCategoria(valor) ? valor : '');
    this.pagina.set(0);
    this.cargar();
  }

  protected cambiarFiltro(valor: string): void {
    this.filtro.set(valor === 'TODOS' ? 'TODOS' : 'VIGENTES');
    this.pagina.set(0);
    this.cargar();
  }

  protected irAPagina(numero: number): void {
    this.pagina.set(numero);
    this.cargar();
  }

  // -------------------------------------------------------------------------------------
  // Subida
  // -------------------------------------------------------------------------------------

  protected abrirSubida(): void {
    this.cerrarPaneles();
    this.formularioSubida.reset();
    this.archivo.set(null);
    this.subidaAbierta.set(true);
  }

  /** Guarda el archivo elegido. Un `<input type="file">` no se ata a un `FormControl`. */
  protected elegirArchivo(entrada: EventTarget | null): void {
    const input = entrada as HTMLInputElement | null;
    this.archivo.set(input?.files?.[0] ?? null);
  }

  protected subir(): void {
    const id = this.identificador();
    const elegido = this.archivo();
    const categoria = this.formularioSubida.getRawValue().categoria;

    if (id === null || elegido === null || !esCategoria(categoria)) {
      // Sin archivo o sin categoria no se manda nada: el backend responderia 400 sobre un
      // parametro, y el operador leeria un error que no le dice cual de los dos campos falta.
      this.formularioSubida.markAllAsTouched();
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api
      .subir(id, categoria, elegido, this.formularioSubida.getRawValue().titulo.trim())
      .subscribe({
        next: (adjunto) => {
          this.enviando.set(false);
          this.subidaAbierta.set(false);
          this.archivo.set(null);
          this.exito.set(
            `Se guardo ${nombreDeAdjunto(adjunto)}. Recorda que un documento adjunto no completa ` +
              'ningun dato de la ficha: si es una credencial, la cobertura hay que cargarla aparte.',
          );
          this.cargar();
        },
        error: (error: unknown) => this.fallo(error),
      });
  }

  // -------------------------------------------------------------------------------------
  // Descarga
  // -------------------------------------------------------------------------------------

  /**
   * Descarga el contenido y se lo entrega al navegador.
   *
   * <p>El nombre sale de `Content-Disposition` cuando el backend lo mando, y si no del
   * `nombreArchivo` de la metadata: guardar el archivo con un nombre generado —o peor, con el id—
   * deja al operador con una carpeta de descargas que no puede leer.
   *
   * <p>El `objectURL` <b>se revoca siempre</b>, incluso si el click fallo. Sin eso el navegador
   * retiene el contenido completo hasta que se cierra la pestaña.
   */
  protected descargar(adjunto: AdjuntoResponse): void {
    const id = this.identificador();
    const adjuntoId = adjunto.id;
    if (id === null || adjuntoId === undefined) {
      return;
    }

    this.limpiarAvisos();
    this.api.descargar(id, adjuntoId).subscribe({
      next: (respuesta) => {
        const contenido = respuesta.body;
        if (contenido === null) {
          return;
        }
        const url = URL.createObjectURL(contenido);
        try {
          const enlace = document.createElement('a');
          enlace.href = url;
          enlace.download =
            nombreDeContentDisposition(respuesta.headers.get('Content-Disposition')) ??
            adjunto.nombreArchivo ??
            'documento';
          enlace.click();
        } finally {
          URL.revokeObjectURL(url);
        }
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Reclasificar y dar de baja
  // -------------------------------------------------------------------------------------

  protected abrirReclasificacion(adjunto: AdjuntoResponse): void {
    const id = adjunto.id;
    if (id === undefined) {
      return;
    }
    this.cerrarPaneles();
    this.formularioClasificacion.reset({
      categoria: adjunto.categoria ?? '',
      titulo: adjunto.titulo ?? '',
    });
    this.panel.set({ id, tipo: 'reclasificar' });
  }

  protected reclasificar(): void {
    const personaId = this.identificador();
    const abierto = this.panel();
    const valores = this.formularioClasificacion.getRawValue();

    if (personaId === null || abierto === null || !esCategoria(valores.categoria)) {
      this.formularioClasificacion.markAllAsTouched();
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api
      .reclasificar(personaId, abierto.id, valores.categoria, valores.titulo.trim())
      .subscribe({
        next: () => {
          this.enviando.set(false);
          this.panel.set(null);
          this.exito.set('Se actualizo la clasificacion del documento.');
          this.cargar();
        },
        error: (error: unknown) => this.fallo(error),
      });
  }

  protected abrirBaja(adjunto: AdjuntoResponse): void {
    const id = adjunto.id;
    if (id === undefined) {
      return;
    }
    this.cerrarPaneles();
    this.panel.set({ id, tipo: 'baja' });
  }

  protected confirmarBaja(motivo: string): void {
    const personaId = this.identificador();
    const abierto = this.panel();
    if (personaId === null || abierto === null) {
      return;
    }

    this.enviando.set(true);
    this.limpiarAvisos();

    this.api.darDeBaja(personaId, abierto.id, motivo).subscribe({
      next: () => {
        this.enviando.set(false);
        this.panel.set(null);
        this.exito.set(
          'El documento quedo dado de baja. El archivo no se borro: se sigue pudiendo descargar, ' +
            'y aparece filtrando por "Todos".',
        );
        this.cargar();
      },
      error: (error: unknown) => this.fallo(error),
    });
  }

  // -------------------------------------------------------------------------------------
  // Paneles y apoyo
  // -------------------------------------------------------------------------------------

  protected cerrarPaneles(): void {
    this.panel.set(null);
    this.subidaAbierta.set(false);
    this.limpiarAvisos();
  }

  protected esPanel(adjunto: AdjuntoResponse, tipo: TipoAccion): boolean {
    const abierto = this.panel();
    return (
      abierto !== null &&
      adjunto.id !== undefined &&
      abierto.id === adjunto.id &&
      abierto.tipo === tipo
    );
  }

  protected mostrarErrorSubida(campo: string): boolean {
    const control = this.formularioSubida.get(campo);
    return control !== null && control.invalid && (control.touched || control.dirty);
  }

  private identificador(): number | null {
    const crudo = Number(this.personaId());
    return Number.isInteger(crudo) && crudo > 0 ? crudo : null;
  }

  private fallo(error: unknown): void {
    this.enviando.set(false);
    const traducido = traducirErrorPersona(error);
    this.errorAccion.set(traducido.mensaje);
    this.causaAccion.set(traducido.causa);
  }

  private limpiarAvisos(): void {
    this.errorAccion.set(null);
    this.causaAccion.set(null);
    this.exito.set(null);
  }

  private reiniciar(): void {
    this.cerrarPaneles();
    this.persona.set(null);
    this.archivo.set(null);
    this.filtroCategoria.set('');
    this.filtro.set('VIGENTES');
    this.pagina.set(0);
  }
}
