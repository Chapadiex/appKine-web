import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subject, catchError, debounceTime, distinctUntilChanged, of, switchMap } from 'rxjs';

import { CreatePersonaRequestTipoDocumentoEnum } from '../../../api/generated/model/create-persona-request';
import { PersonaResponse } from '../../../api/generated/model/persona-response';
import { AkineHttpError } from '../../../core/interceptors/error.interceptor';
import { PERMISO_PACIENTE_MANAGE } from '../../../core/models/permisos';
import { Alerta } from '../../../shared/components/alerta/alerta';
import { PermisoDirective } from '../../../shared/directives/permiso.directive';
import { traducirErrorAgenda } from '../models/agenda-errors';
import { SchedulingApi } from '../services/scheduling-api';

const ESPERA_DE_BUSQUEDA_MS = 300;

/**
 * Buscar a quien se le da el turno, y darlo de alta sin salir del flujo (TURNO - Tecnico §7 y §8).
 *
 * <p>La busqueda es del servidor y por teclazo, y <b>`switchMap` cancela la anterior</b>: con el
 * `setTimeout` de las pantallas viejas, una respuesta lenta de "Per" podia pisar a la de "Perez".
 *
 * <p>El alta rapida son dos llamadas en el contrato: la persona y su perfil de paciente, porque
 * Persona y Paciente son cosas distintas (03.01). El turno exige el perfil, asi que aca van juntas. Si
 * la segunda falla, la persona ya existe y el reintento solo repite la activacion.
 */
@Component({
  selector: 'app-buscador-de-paciente',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Alerta, PermisoDirective, ReactiveFormsModule],
  styleUrl: './flujo.css',
  template: `
    @if (!creando()) {
      <div class="flujo">
        <div class="campo combo">
          <label for="flujo-paciente">Buscar paciente</label>
          <input
            id="flujo-paciente"
            type="search"
            role="combobox"
            autocomplete="off"
            aria-autocomplete="list"
            aria-controls="flujo-paciente-opciones"
            [attr.aria-expanded]="desplegado()"
            [attr.aria-activedescendant]="idActivo()"
            placeholder="Nombre, apellido, DNI, teléfono o correo"
            (input)="buscar($any($event.target).value)"
            (focus)="abierto.set(true)"
            (blur)="abierto.set(false)"
            (keydown)="alTeclear($event)"
          />

          <!-- mousedown sin foco: el clic en una opcion no le saca el foco al campo ni cierra la lista. -->
          @if (desplegado()) {
            <div class="combo__panel" (mousedown)="$event.preventDefault()">
              @if (candidatos().length > 0) {
                <ul
                  id="flujo-paciente-opciones"
                  class="candidatos"
                  role="listbox"
                  aria-label="Pacientes encontrados"
                >
                  @for (candidata of candidatos(); track candidata.id; let i = $index) {
                    <li
                      [id]="'flujo-paciente-opcion-' + i"
                      class="candidato"
                      role="option"
                      [class.candidato--activo]="i === activo()"
                      [attr.aria-selected]="i === activo()"
                      tabindex="-1"
                      (click)="elegir(candidata)"
                      (keydown.enter)="elegir(candidata)"
                    >
                      <span class="candidato__nombre"
                        >{{ candidata.apellido }}, {{ candidata.nombre }}</span
                      >
                      <span class="candidato__datos">{{ datosDe(candidata) }}</span>
                    </li>
                  }
                </ul>
                @if (total() > candidatos().length) {
                  <p class="combo__nota">
                    Se muestran {{ candidatos().length }} de {{ total() }}. Seguí escribiendo para
                    acotar.
                  </p>
                }
              } @else {
                <p class="estado estado--vacio combo__nota">No encontramos pacientes.</p>
              }

              <p class="combo__pie" *akinePermiso="PERMISO_PACIENTE_MANAGE">
                <button type="button" class="boton boton--secundario" (click)="abrirAlta()">
                  Crear paciente
                </button>
              </p>
            </div>
          }
        </div>

        @if (errorDeBusqueda(); as error) {
          <p class="estado estado--error" role="alert">{{ error }}</p>
        }
      </div>
    } @else {
      <form class="flujo" [formGroup]="alta" (ngSubmit)="crear()">
        <h3 class="flujo__dato">Paciente nuevo</h3>

        @if (errorDeAlta(); as error) {
          <app-alerta tipo="advertencia" [titulo]="tituloDelError()">
            <p>{{ error }}</p>
            @if (existente(); as persona) {
              <p class="alerta__acciones">
                <button
                  type="button"
                  class="boton boton--secundario"
                  (click)="usarExistente(persona)"
                >
                  Usar {{ persona.apellido }}, {{ persona.nombre }}
                </button>
              </p>
            }
            @if (posibleDuplicado()) {
              <p class="alerta__acciones">
                <button type="button" class="boton boton--secundario" (click)="crear(true)">
                  Es otra persona: crearla igual
                </button>
              </p>
            }
          </app-alerta>
        }

        <div class="flujo__campos">
          <div class="campo campo--mitad">
            <label for="flujo-alta-nombre">Nombre</label>
            <input id="flujo-alta-nombre" formControlName="nombre" autocomplete="off" required />
          </div>
          <div class="campo campo--mitad">
            <label for="flujo-alta-apellido">Apellido</label>
            <input
              id="flujo-alta-apellido"
              formControlName="apellido"
              autocomplete="off"
              required
            />
          </div>
          <div class="campo campo--mitad">
            <label for="flujo-alta-dni">DNI</label>
            <input
              id="flujo-alta-dni"
              formControlName="dni"
              inputmode="numeric"
              autocomplete="off"
              required
            />
          </div>
          <div class="campo campo--mitad">
            <label for="flujo-alta-telefono">Teléfono</label>
            <input
              id="flujo-alta-telefono"
              formControlName="telefono"
              type="tel"
              autocomplete="off"
              required
            />
          </div>
          <div class="campo">
            <label for="flujo-alta-correo">Correo (opcional)</label>
            <input
              id="flujo-alta-correo"
              formControlName="correo"
              type="email"
              autocomplete="off"
            />
          </div>
        </div>

        @if (faltanDatos()) {
          <p class="estado estado--error" role="alert">
            Completá nombre, apellido, DNI y teléfono para continuar.
          </p>
        }

        <div class="acciones">
          <button type="button" class="boton boton--secundario" (click)="creando.set(false)">
            Volver
          </button>
          <button type="submit" class="boton" [disabled]="enviando()">
            {{ enviando() ? 'Creando…' : 'Crear paciente' }}
          </button>
        </div>
      </form>
    }
  `,
})
export class BuscadorDePaciente {
  private readonly api = inject(SchedulingApi);

  readonly elegida = output<PersonaResponse>();

  protected readonly PERMISO_PACIENTE_MANAGE = PERMISO_PACIENTE_MANAGE;

  protected readonly candidatos = signal<readonly PersonaResponse[]>([]);
  protected readonly total = signal(0);
  protected readonly busco = signal(false);
  /** El foco esta en el campo. La lista se despliega solo si ademas hay algo que mostrar. */
  protected readonly abierto = signal(false);
  /** La opcion marcada con las flechas, -1 ninguna. */
  protected readonly activo = signal(-1);
  protected readonly desplegado = computed(
    () => this.abierto() && (this.busco() || this.candidatos().length > 0),
  );
  protected readonly idActivo = computed(() =>
    this.desplegado() && this.activo() >= 0 ? `flujo-paciente-opcion-${this.activo()}` : null,
  );
  protected readonly errorDeBusqueda = signal<string | null>(null);

  protected readonly creando = signal(false);
  protected readonly enviando = signal(false);
  protected readonly faltanDatos = signal(false);
  protected readonly errorDeAlta = signal<string | null>(null);
  protected readonly tituloDelError = signal('No pudimos crear al paciente');
  protected readonly existente = signal<PersonaResponse | null>(null);
  protected readonly posibleDuplicado = signal(false);

  protected readonly alta = new FormGroup({
    nombre: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    apellido: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    dni: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    telefono: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    correo: new FormControl('', { nonNullable: true }),
  });

  private readonly textos = new Subject<string>();
  /** Lo ultimo escrito: precarga el alta, para no volver a pedir lo que ya se tipeo. */
  private ultimoTexto = '';

  constructor() {
    this.textos
      .pipe(
        debounceTime(ESPERA_DE_BUSQUEDA_MS),
        distinctUntilChanged(),
        switchMap((texto) => {
          if (texto === '') {
            this.candidatos.set([]);
            this.total.set(0);
            this.busco.set(false);
            return of(null);
          }
          this.errorDeBusqueda.set(null);
          return this.api.buscarPersonas(texto).pipe(
            catchError((error: unknown) => {
              this.errorDeBusqueda.set(traducirErrorAgenda(error).mensaje);
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((pagina) => {
        if (pagina !== null) {
          const contenido = pagina.content ?? [];
          this.candidatos.set(contenido);
          this.total.set(pagina.totalElements ?? contenido.length);
          this.activo.set(-1);
          this.busco.set(true);
        }
      });
  }

  protected buscar(texto: string): void {
    this.ultimoTexto = texto.trim();
    this.abierto.set(true);
    this.textos.next(this.ultimoTexto);
  }

  /** Flechas, Enter y Escape, como cualquier combo (patron combobox de ARIA). */
  protected alTeclear(evento: KeyboardEvent): void {
    const cantidad = this.candidatos().length;
    switch (evento.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        evento.preventDefault();
        this.abierto.set(true);
        if (cantidad === 0) return;
        const paso = evento.key === 'ArrowDown' ? 1 : -1;
        this.activo.update((i) => (i + paso + cantidad) % cantidad);
        return;
      }
      case 'Enter': {
        const candidata = this.candidatos()[this.activo()];
        if (this.desplegado() && candidata) {
          evento.preventDefault();
          this.elegir(candidata);
        }
        return;
      }
      case 'Escape':
        // Cierra la lista y no el panel: el dialog modal escucha el mismo Escape.
        if (this.desplegado()) {
          evento.preventDefault();
          evento.stopPropagation();
          this.abierto.set(false);
        }
        return;
    }
  }

  protected elegir(persona: PersonaResponse): void {
    this.abierto.set(false);
    this.elegida.emit(persona);
  }

  protected datosDe(persona: PersonaResponse): string {
    const documento = persona.numeroDocumento
      ? `${persona.tipoDocumento ?? 'DNI'} ${persona.numeroDocumento}`
      : 'Sin documento';
    return [documento, persona.telefono, persona.email].filter(Boolean).join(' · ');
  }

  protected abrirAlta(): void {
    const texto = this.ultimoTexto;
    if (/^\d+$/.test(texto)) {
      this.alta.controls.dni.setValue(texto);
    } else if (texto !== '') {
      const [apellido, ...nombre] = texto.split(/\s+/);
      this.alta.controls.apellido.setValue(apellido);
      this.alta.controls.nombre.setValue(nombre.join(' '));
    }
    this.creando.set(true);
  }

  protected crear(confirmaDuplicado = false): void {
    if (this.alta.invalid) {
      this.faltanDatos.set(true);
      return;
    }
    this.faltanDatos.set(false);
    this.errorDeAlta.set(null);
    this.existente.set(null);
    this.posibleDuplicado.set(false);
    this.enviando.set(true);

    const datos = this.alta.getRawValue();
    this.api
      .crearPersona({
        nombre: datos.nombre.trim(),
        apellido: datos.apellido.trim(),
        tipoDocumento: CreatePersonaRequestTipoDocumentoEnum.DNI,
        numeroDocumento: datos.dni.trim(),
        telefono: datos.telefono.trim(),
        email: datos.correo.trim() === '' ? undefined : datos.correo.trim(),
        confirmaPosibleDuplicado: confirmaDuplicado || undefined,
      })
      .subscribe({
        next: (persona) => this.activar(persona),
        error: (error: unknown) => this.alRechazarAlta(error),
      });
  }

  private activar(persona: PersonaResponse): void {
    this.api.activarPerfilDePaciente(persona.id ?? 0).subscribe({
      next: (activada) => {
        this.enviando.set(false);
        this.elegida.emit(activada);
      },
      error: (error: unknown) => {
        this.enviando.set(false);
        this.tituloDelError.set('La persona se creó, pero no pudimos activarla como paciente');
        this.errorDeAlta.set(traducirErrorAgenda(error).mensaje);
        this.existente.set(persona);
      },
    });
  }

  protected usarExistente(persona: PersonaResponse): void {
    if (persona.esPaciente) {
      this.elegida.emit(persona);
      return;
    }
    this.enviando.set(true);
    this.errorDeAlta.set(null);
    this.activar(persona);
  }

  private alRechazarAlta(error: unknown): void {
    this.enviando.set(false);
    this.tituloDelError.set('No pudimos crear al paciente');
    if (error instanceof AkineHttpError && error.problemType === 'persona-documento-taken') {
      this.errorDeAlta.set('Ya hay una persona con ese documento.');
      const id = error.numeroDeExtension('personaExistenteId');
      if (id !== null) {
        this.api.verPersona(id).subscribe((persona) => this.existente.set(persona));
      }
      return;
    }
    if (error instanceof AkineHttpError && error.problemType === 'persona-posible-duplicado') {
      this.errorDeAlta.set(
        'Hay una persona muy parecida. Revisá si no es la misma antes de seguir.',
      );
      this.posibleDuplicado.set(true);
      return;
    }
    this.errorDeAlta.set(traducirErrorAgenda(error).mensaje);
  }
}
