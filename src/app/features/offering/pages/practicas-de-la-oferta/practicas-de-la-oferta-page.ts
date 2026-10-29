import { Pestanas } from '../../../../shared/components/pestanas/pestanas';
import { ETIQUETA_PESTANAS_DE_OFERTA, pestanasDeOferta } from '../../models/pestanas-de-offering';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { CatalogoConceptoResponse } from '../../../../api/generated/model/catalogo-concepto-response';
import { EstadoDeListado } from '../../../../shared/utils/estado-de-listado';
import { PERMISO_CONSULTORIO_MANAGE } from '../../../../core/models/permisos';
import { PermisoDirective } from '../../../../shared/directives/permiso.directive';
import { PracticasDeOfertaResponse } from '../../../../api/generated/model/practicas-de-oferta-response';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { OfferingApi } from '../../services/offering-api';
import { esSinPermiso } from '../../../../core/interceptors/error.interceptor';
import { CausaOffering, hayQueRecargar, traducirErrorOffering } from '../../models/offering-errors';
import { Ayuda } from '../../../../shared/components/ayuda/ayuda';
import { Migas } from '../../../../shared/components/migas/migas';
import { CabeceraDePagina } from '../../../../shared/components/cabecera-de-pagina/cabecera-de-pagina';

import { Alerta } from '../../../../shared/components/alerta/alerta';
import { AvisosStore } from '../../../../core/services/avisos.store';

/** Una practica de la lista que se va a guardar. */
interface FilaPractica {
  readonly practicaId: number;
  readonly nombre: string;
  readonly codigo: string;
  /**
   * `true` si el catalogo ya no la deja elegir. La oferta la conserva y la fila sigue valiendo
   * (A-9 §8): se muestra con la advertencia, no se esconde.
   */
  readonly fueraDelCatalogo: boolean;
}

/**
 * Practicas que una oferta puede prestar, y cual es la principal (AKINE A-9, DP-11).
 *
 * <h2>Para que sirve, y por que la pantalla lo dice con palabras</h2>
 *
 * <p>La oferta es lo que el centro vende ("Kinesiologia traumatologica"); la practica es lo que el
 * financiador reconoce y paga. Esta lista es el puente: la cobertura aplicable mira estas
 * practicas, y cuando una sesion cierra <b>sin tratamientos registrados</b> el devengo al
 * financiador y el consumo de la autorizacion usan la <b>principal</b>. Si hubo tratamientos,
 * manda la practica realizada.
 *
 * <h2>Vacia NO significa "todas"</h2>
 *
 * <p>Al reves que las habilitaciones. Una oferta sin practicas (Pilates, por ejemplo) no le
 * devenga nada a ningun financiador. La pantalla lo avisa en vivo, antes de guardar.
 *
 * <h2>Se guarda el conjunto entero</h2>
 *
 * <p>Igual que las habilitaciones: un boton manda la lista completa con la principal y la version
 * de la OFERTA, que es la misma que usan las habilitaciones. A diferencia de aquellas, la
 * respuesta trae {@code ofertaVersion}, asi que no hace falta releer la oferta para el proximo
 * guardado.
 */
@Component({
  selector: 'app-practicas-de-la-oferta-page',
  imports: [CabeceraDePagina, Migas, Pestanas, Ayuda, RouterLink, PermisoDirective, Alerta],
  templateUrl: './practicas-de-la-oferta-page.html',
  styleUrl: '../../offering.css',
})
export class PracticasDeLaOfertaPage {
  private readonly api = inject(OfferingApi);
  private readonly avisos = inject(AvisosStore);
  private readonly contexto = inject(TenantContextStore);
  private readonly ruta = inject(ActivatedRoute);

  protected readonly PERMISO_CONSULTORIO_MANAGE = PERMISO_CONSULTORIO_MANAGE;

  protected readonly ofertaId = Number(this.ruta.snapshot.paramMap.get('ofertaId'));
  protected readonly pestanasDeOferta = pestanasDeOferta(this.ofertaId);
  protected readonly etiquetaDePestanas = ETIQUETA_PESTANAS_DE_OFERTA;

  protected readonly estado = signal<EstadoDeListado<PracticasDeOfertaResponse>>({
    tipo: 'cargando',
  });
  protected readonly guardando = signal(false);
  protected readonly errorAccion = signal<string | null>(null);
  protected readonly causaAccion = signal<CausaOffering | null>(null);

  /** La lista que se va a guardar, que puede diferir de la guardada. */
  protected readonly seleccion = signal<readonly FilaPractica[]>([]);
  protected readonly principal = signal<number | null>(null);

  protected readonly textoBusqueda = signal('');
  protected readonly buscando = signal(false);
  protected readonly resultados = signal<readonly CatalogoConceptoResponse[] | null>(null);
  protected readonly errorBusqueda = signal<string | null>(null);

  /** Lo cargado, o `null`. El `@switch` de la plantilla no estrecha la union. */
  protected readonly configuracion = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'listo' ? actual.pagina : null;
  });

  protected readonly mensajeDeCarga = computed(() => {
    const actual = this.estado();
    return actual.tipo === 'error' ? actual.mensaje : null;
  });

  /** Las filas dadas de baja, con su motivo: historia, no se editan. */
  protected readonly dadasDeBaja = computed(() =>
    (this.configuracion()?.practicas ?? []).filter((fila) => fila.estado === 'INACTIVO'),
  );

  protected readonly hayCambios = computed(() => {
    const guardada = this.configuracion();
    if (guardada === null) {
      return false;
    }
    const antes = activas(guardada).map((fila) => fila.practicaId ?? 0);
    const ahora = this.seleccion().map((fila) => fila.practicaId);
    return (
      (guardada.practicaPrincipalId ?? null) !== this.principal() ||
      antes.length !== ahora.length ||
      antes.some((id) => !ahora.includes(id))
    );
  });

  protected readonly hayQueRecargar = computed(() => hayQueRecargar(this.causaAccion()));

  constructor() {
    this.cargar();
  }

  protected cargar(): void {
    const consultorioId = this.contexto.consultorioId();
    if (consultorioId === null) {
      this.estado.set({ tipo: 'sin-contexto' });
      return;
    }

    this.estado.set({ tipo: 'cargando' });
    this.api.verPracticas(consultorioId, this.ofertaId).subscribe({
      next: (respuesta) => this.pintar(respuesta),
      error: (error: unknown) => {
        const traducido = traducirErrorOffering(error, 'oferta');
        this.estado.set({
          tipo: 'error',
          mensaje: traducido.mensaje,
          faltaContexto: traducido.causa === 'sin-contexto',
        });
      },
    });
  }

  protected escribirBusqueda(evento: Event): void {
    this.textoBusqueda.set((evento.target as HTMLInputElement).value);
  }

  protected buscar(evento: Event): void {
    evento.preventDefault();
    this.buscando.set(true);
    this.errorBusqueda.set(null);
    this.api.buscarPracticasDelCatalogo(this.textoBusqueda()).subscribe({
      next: (pagina) => {
        this.buscando.set(false);
        this.resultados.set(pagina.content ?? []);
      },
      error: (error: unknown) => {
        this.buscando.set(false);
        this.resultados.set(null);
        // El 403 de la busqueda es del catalogo clinico (`catalogo:read`, DP-36), no de la oferta:
        // el texto de `traducirErrorOffering` culparia a `consultorio:manage`.
        this.errorBusqueda.set(
          esSinPermiso(error)
            ? 'No tenés permiso para consultar el catalogo clínico, así que no podés buscar ' +
                'prácticas. Pediselo a quien administra el centro.'
            : traducirErrorOffering(error, 'oferta').mensaje,
        );
      },
    });
  }

  protected yaEsta(practicaId: number | undefined): boolean {
    return this.seleccion().some((fila) => fila.practicaId === practicaId);
  }

  /** Suma una practica. La primera que entra queda como principal, que es obligatoria. */
  protected agregar(concepto: CatalogoConceptoResponse): void {
    const practicaId = concepto.id;
    if (practicaId === undefined || this.yaEsta(practicaId)) {
      return;
    }
    this.seleccion.update((actuales) => [
      ...actuales,
      {
        practicaId,
        nombre: concepto.name ?? `Práctica #${practicaId}`,
        codigo: concepto.codigo ?? '',
        fueraDelCatalogo: false,
      },
    ]);
    if (this.principal() === null) {
      this.principal.set(practicaId);
    }
  }

  /** Saca una practica. Si era la principal, la marca pasa a la primera que quede. */
  protected quitar(practicaId: number): void {
    const restantes = this.seleccion().filter((fila) => fila.practicaId !== practicaId);
    this.seleccion.set(restantes);
    if (this.principal() === practicaId) {
      this.principal.set(restantes[0]?.practicaId ?? null);
    }
  }

  protected marcarPrincipal(practicaId: number): void {
    this.principal.set(practicaId);
  }

  protected guardar(): void {
    const consultorioId = this.contexto.consultorioId();
    const version = this.configuracion()?.ofertaVersion;
    if (consultorioId === null || version === undefined) {
      this.errorAccion.set(MENSAJE_SIN_VERSION);
      return;
    }

    this.guardando.set(true);
    this.errorAccion.set(null);
    this.causaAccion.set(null);

    const ids = this.seleccion().map((fila) => fila.practicaId);
    this.api
      .fijarPracticas(
        consultorioId,
        this.ofertaId,
        ids,
        ids.length === 0 ? null : this.principal(),
        version,
      )
      .subscribe({
        next: (respuesta) => {
          this.guardando.set(false);
          this.pintar(respuesta);
          this.avisos.exito('Prácticas guardadas');
        },
        error: (error: unknown) => {
          this.guardando.set(false);
          const traducido = traducirErrorOffering(error, 'oferta');
          this.errorAccion.set(
            traducido.causa === 'no-encontrado' ? MENSAJE_NO_ENCONTRADO : traducido.mensaje,
          );
          this.causaAccion.set(traducido.causa);
          if (traducido.causa === 'concurrencia') {
            // El 409 no piso nada: se relee para decidir sobre los datos actuales.
            this.cargar();
          }
        },
      });
  }

  /** Repinta con lo que dijo el servidor, nunca con lo que la pantalla creia tener. */
  private pintar(respuesta: PracticasDeOfertaResponse): void {
    this.estado.set({ tipo: 'listo', pagina: respuesta });
    this.seleccion.set(
      activas(respuesta).map((fila) => ({
        practicaId: fila.practicaId ?? 0,
        nombre: fila.nombre ?? `Práctica #${fila.practicaId}`,
        codigo: fila.codigo ?? '',
        fueraDelCatalogo: fila.vigenteEnCatalogo === false,
      })),
    );
    this.principal.set(respuesta.practicaPrincipalId ?? null);
  }
}

function activas(respuesta: PracticasDeOfertaResponse) {
  return (respuesta.practicas ?? []).filter((fila) => fila.estado !== 'INACTIVO');
}

const MENSAJE_SIN_VERSION =
  'No pudimos leer la versión de la oferta, y sin ella no se puede guardar: mandar una inventada ' +
  'pisaria la edicion de otra persona. Recarga las prácticas y volvé a intentar.';

/**
 * El 404 del reemplazo tiene dos causas posibles y el backend no las distingue a proposito: la
 * oferta ya no existe, o una practica que se agrego no es visible para el centro.
 */
const MENSAJE_NO_ENCONTRADO =
  'No encontramos la oferta, o alguna de las prácticas que agregaste no es visible para este ' +
  'centro. Recarga las prácticas y volvé a armar la lista.';
