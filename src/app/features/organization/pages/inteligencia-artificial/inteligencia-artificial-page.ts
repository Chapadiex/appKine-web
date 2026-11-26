import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Observable } from 'rxjs';

import { InteligenciaArtificialDelCentroService } from '../../../../api/generated/api/inteligencia-artificial-del-centro.service';
import { EstadoDelMotorResponse } from '../../../../api/generated/model/estado-del-motor-response';
import { FuncionIaResponse } from '../../../../api/generated/model/funcion-ia-response';
import { FuncionesIaResponse } from '../../../../api/generated/model/funciones-ia-response';
import { PruebaDelMotorResponse } from '../../../../api/generated/model/prueba-del-motor-response';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import {
  ETIQUETA_PESTANAS_DE_ORGANIZACION,
  pestanasDeOrganizacion,
} from '../../../../core/models/pestanas-de-organizacion';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { FuncionIa, FuncionesIaStore } from '../../../../core/services/funciones-ia.store';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { Alerta } from '../../../../shared/components/alerta/alerta';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';
import { Icono } from '../../../../shared/components/icono/icono';
import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { ColumnaOrdenable } from '../../../../shared/components/tabla/columna-ordenable';
import { PieDeTabla } from '../../../../shared/components/tabla/pie-de-tabla';
import { tablaLocal } from '../../../../shared/components/tabla/tabla-local';

/** Lo que la pantalla dice de cada funcion: nombre, para que sirve y que pantallas prende. */
interface DescripcionDeFuncion {
  readonly titulo: string;
  readonly uso: string;
  readonly pantallas: string;
}

/** Los proveedores del asistente (contrato 0.193.0). El compatible sin key es lo normal. */
const PROVEEDORES: Readonly<Record<string, string>> = {
  claude: 'Claude (Anthropic)',
  compatible: 'Motor compatible (Ollama u otro)',
  prueba: 'Proveedor de prueba',
};

const DESCRIPCIONES: Readonly<Record<FuncionIa, DescripcionDeFuncion>> = {
  ASISTENTE: {
    titulo: 'Asistente de datos',
    uso: 'Responde preguntas sobre turnos, sesiones, clases y reportes de la sede.',
    pantallas: 'Atención → Asistente de datos y el botón flotante.',
  },
  EVOLUCION: {
    titulo: 'Evolución del caso',
    uso: 'Alertas e indicadores calculados sobre las sesiones cerradas de un caso clínico.',
    pantallas: 'La sección Evolución en la ficha del caso.',
  },
  SUGERENCIAS: {
    titulo: 'Sugerencias de evolución',
    uso: 'Propone revisar el tratamiento, con citas de la biblioteca. El profesional decide.',
    pantallas: 'Dentro de Evolución, en la ficha del caso. Necesita Evolución y Biblioteca.',
  },
  BIBLIOTECA: {
    titulo: 'Biblioteca del centro',
    uso: 'Libros del centro con búsqueda y consulta con el modelo.',
    pantallas: 'Configuración → Bibliografía de la IA y Atención → Consultar bibliografía.',
  },
};

const ORDEN: readonly FuncionIa[] = ['ASISTENTE', 'EVOLUCION', 'SUGERENCIAS', 'BIBLIOTECA'];

/** Una fila de la tabla de funciones, ya resuelta para la plantilla. */
interface FilaDeFuncion extends DescripcionDeFuncion {
  readonly funcion: FuncionIa;
  readonly centro: boolean;
  readonly despliegue: boolean;
  readonly activa: boolean;
  readonly estado: { readonly texto: string; readonly tono: 'activa' | 'neutra' | 'suspendida' };
}

/**
 * Organizacion → Inteligencia artificial: que funciones de IA usa el centro y en que estado esta el
 * servidor de modelos (Ollama).
 *
 * <p><b>Cada interruptor guarda al tocarlo</b>, con la version leida: es una sola decision por vez y
 * un boton "Guardar" aparte seria una segunda accion primaria. Al guardar, el menu y las pantallas
 * se actualizan en el momento (`FuncionesIaStore.adoptar`).
 *
 * <p>Una funcion que el servidor no ofrece se ve con el interruptor deshabilitado y el motivo: el
 * centro no puede prenderla desde aca, la prende quien administra el despliegue.
 */
@Component({
  selector: 'app-inteligencia-artificial-page',
  imports: [CabeceraDePagina, Pestanas, Ayuda, Alerta, Icono, ColumnaOrdenable, PieDeTabla],
  templateUrl: './inteligencia-artificial-page.html',
  styleUrls: ['../../organization.css', './inteligencia-artificial-page.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InteligenciaArtificialPage {
  protected readonly pestanasDeOrganizacion = pestanasDeOrganizacion(inject(PermissionsStore));
  protected readonly etiquetaDePestanasDeOrganizacion = ETIQUETA_PESTANAS_DE_ORGANIZACION;

  private readonly api = inject(InteligenciaArtificialDelCentroService);
  private readonly tenant = inject(TenantContextStore);
  private readonly store = inject(FuncionesIaStore);
  private readonly avisos = inject(AvisosStore);

  protected readonly estado = signal<'cargando' | 'listo' | 'error'>('cargando');
  protected readonly mensajeDeCarga = signal('');
  protected readonly guardando = signal<FuncionIa | null>(null);
  protected readonly errorAlGuardar = signal<string | null>(null);

  private readonly funciones = signal<FuncionesIaResponse | null>(null);

  protected readonly motor = signal<EstadoDelMotorResponse | null>(null);
  protected readonly motorOcupado = signal<'consultando' | 'cargando' | 'probando' | null>(null);
  protected readonly prueba = signal<PruebaDelMotorResponse | null>(null);

  protected readonly filas = computed<readonly FilaDeFuncion[]>(() => {
    const leidas = this.funciones();
    if (leidas === null) {
      return [];
    }
    const por = new Map(leidas.funciones.map((f) => [f.funcion as FuncionIa, f]));
    return ORDEN.map((funcion) => {
      const f = por.get(funcion);
      return f === undefined ? null : this.fila(funcion, f, por);
    }).filter((f): f is FilaDeFuncion => f !== null);
  });

  /** Modelos del motor: la lista llega entera, asi que se ordena y pagina en el navegador. */
  protected readonly tablaDeModelos = tablaLocal(
    computed(() => this.motor()?.modelos ?? []),
    {
      columnas: {
        modelo: (m) => m.nombre,
        descargado: (m) => m.descargado,
        memoria: (m) => (m.cargado ? m.memoriaMb : null),
        ejecucion: (m) => m.ejecucion,
      },
    },
  );

  /** El modelo cargado corre entero en la placa de video: es lo que hace que responda rapido. */
  protected readonly enGpu = computed(() =>
    (this.motor()?.modelos ?? []).some((m) => m.ejecucion === 'GPU'),
  );

  constructor() {
    effect(() => {
      this.tenant.contextEpoch();
      untracked(() => {
        this.guardando.set(null);
        this.prueba.set(null);
        this.cargar();
        this.consultarMotor();
      });
    });
  }

  protected cargar(): void {
    const orgId = this.tenant.organizationId();
    if (orgId === null) {
      return;
    }
    this.estado.set('cargando');
    this.delContextoActual(this.api.getFuncionesIaDeOrganizacion({ orgId })).subscribe({
      next: (funciones) => {
        this.funciones.set(funciones);
        this.estado.set('listo');
      },
      error: (error: unknown) => {
        this.mensajeDeCarga.set(mensajeDe(error));
        this.estado.set('error');
      },
    });
  }

  protected alternar(funcion: FuncionIa, interruptor: HTMLInputElement): void {
    const prendida = interruptor.checked;
    const orgId = this.tenant.organizationId();
    const actual = this.funciones();
    if (orgId === null || actual === null || this.guardando() !== null) {
      return;
    }
    const centro = (f: FuncionIa): boolean =>
      f === funcion ? prendida : (actual.funciones.find((x) => x.funcion === f)?.centro ?? true);
    this.guardando.set(funcion);
    this.errorAlGuardar.set(null);
    this.delContextoActual(
      this.api.updateFuncionesIaDeOrganizacion({
        orgId,
        updateFuncionesIaRequest: {
          asistente: centro('ASISTENTE'),
          evolucion: centro('EVOLUCION'),
          sugerencias: centro('SUGERENCIAS'),
          biblioteca: centro('BIBLIOTECA'),
          version: actual.version,
        },
      }),
    ).subscribe({
      next: (guardadas) => {
        this.funciones.set(guardadas);
        this.store.adoptar(guardadas);
        this.guardando.set(null);
        this.avisos.exito(
          `${DESCRIPCIONES[funcion].titulo} ${prendida ? 'prendida' : 'apagada'} para el centro`,
        );
      },
      error: (error: unknown) => {
        this.guardando.set(null);
        const conflicto =
          error instanceof AkineHttpError && error.problemType === 'concurrent-modification';
        this.errorAlGuardar.set(
          conflicto
            ? 'Otra persona cambió esta configuración recién. Recargamos lo último: revisalo y volvé a intentar.'
            : mensajeDe(error),
        );
        // Angular no repinta [checked] si el valor ligado no cambio: el interruptor vuelve a mano.
        interruptor.checked = !prendida;
        this.cargar();
      },
    });
  }

  protected consultarMotor(): void {
    this.ejercitarMotor('consultando', (orgId) => this.api.getEstadoDelMotorDeIa({ orgId }));
  }

  protected precargar(): void {
    this.ejercitarMotor('cargando', (orgId) => this.api.precargarMotorDeIa({ orgId }));
  }

  protected probar(): void {
    const orgId = this.tenant.organizationId();
    if (orgId === null || this.motorOcupado() !== null) {
      return;
    }
    this.motorOcupado.set('probando');
    this.prueba.set(null);
    this.delContextoActual(this.api.probarMotorDeIa({ orgId })).subscribe({
      next: (prueba) => {
        this.prueba.set(prueba);
        this.motorOcupado.set(null);
        this.consultarMotor();
      },
      error: (error: unknown) => {
        this.prueba.set({ ok: false, milisegundos: 0, error: mensajeDe(error) });
        this.motorOcupado.set(null);
      },
    });
  }

  protected nombreDeFuncion(codigo: string): string {
    return DESCRIPCIONES[codigo as FuncionIa]?.titulo ?? codigo;
  }

  /** El proveedor del asistente en palabras: `claude`, `compatible` o `prueba`. */
  protected nombreDeProveedor(nombre: string): string {
    return PROVEEDORES[nombre] ?? nombre;
  }

  protected segundos(milisegundos: number): string {
    return (milisegundos / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  }

  private ejercitarMotor(
    ocupado: 'consultando' | 'cargando',
    pedido: (orgId: number) => Observable<EstadoDelMotorResponse>,
  ): void {
    const orgId = this.tenant.organizationId();
    if (orgId === null || this.motorOcupado() !== null) {
      return;
    }
    this.motorOcupado.set(ocupado);
    this.delContextoActual(pedido(orgId)).subscribe({
      next: (estado) => {
        this.motor.set(estado);
        this.motorOcupado.set(null);
      },
      error: (error: unknown) => {
        this.motor.set({ alcanzable: false, error: mensajeDe(error), modelos: [] });
        this.motorOcupado.set(null);
      },
    });
  }

  private fila(
    funcion: FuncionIa,
    f: FuncionIaResponse,
    por: ReadonlyMap<FuncionIa, FuncionIaResponse>,
  ): FilaDeFuncion {
    const base = {
      ...DESCRIPCIONES[funcion],
      funcion,
      centro: f.centro,
      despliegue: f.despliegue,
      activa: f.activa,
    };
    if (!f.despliegue) {
      return { ...base, estado: { texto: 'No disponible en el servidor', tono: 'suspendida' } };
    }
    if (!f.centro) {
      return { ...base, estado: { texto: 'Apagada para el centro', tono: 'neutra' } };
    }
    if (!f.activa && funcion === 'SUGERENCIAS') {
      const faltan = (['EVOLUCION', 'BIBLIOTECA'] as const)
        .filter((d) => !por.get(d)?.activa)
        .map((d) => DESCRIPCIONES[d].titulo);
      return {
        ...base,
        estado: {
          texto: faltan.length > 0 ? `Necesita ${faltan.join(' y ')}` : 'No disponible',
          tono: 'suspendida',
        },
      };
    }
    return { ...base, estado: { texto: 'Activa', tono: 'activa' } };
  }

  /** Descarta la respuesta de un pedido que salio con otro centro elegido. */
  private delContextoActual<T>(pedido: Observable<T>): Observable<T> {
    const epoca = this.tenant.contextEpoch();
    const vigente = (): boolean => this.tenant.contextEpoch() === epoca;
    return new Observable<T>((destino) =>
      pedido.subscribe({
        next: (valor) => vigente() && destino.next(valor),
        error: (error: unknown) => vigente() && destino.error(error),
        complete: () => destino.complete(),
      }),
    );
  }
}

function mensajeDe(error: unknown): string {
  return error instanceof AkineHttpError ? error.mensaje : 'Volvé a intentar en un momento.';
}
