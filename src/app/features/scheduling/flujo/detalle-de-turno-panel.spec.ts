import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { provideApi } from '../../../api/generated/provide-api';
import { errorInterceptor } from '../../../core/interceptors/error.interceptor';
import {
  PERMISO_HC_READ,
  PERMISO_SESION_REGISTER,
  PERMISO_TURNO_MANAGE,
} from '../../../core/models/permisos';
import { AvisosStore } from '../../../core/services/avisos.store';
import { DiaDeLaSede } from '../../../core/services/dia-de-la-sede';
import { FlujoDeTurnosStore } from '../../../core/services/flujo-de-turnos.store';
import { PermissionsStore } from '../../../core/services/permissions.store';
import { TenantContextStore } from '../../../core/services/tenant-context.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../core/testing/axe';
import { fijarReloj, soltarReloj } from '../../../core/testing/reloj';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../core/testing/rutas-api';
import { DetalleDeTurnoPanel } from './detalle-de-turno-panel';

const SEDE = '/api/v1/consultorios/3';
const TURNO = `${SEDE}/turnos/7`;
const BUSQUEDA = `${SEDE}/disponibilidad/busqueda`;
const COINCIDENCIAS = `${SEDE}/lista-de-espera/coincidencias`;

const FUTURO = '2030-03-04T12:00:00Z';
const PASADO = '2020-03-04T12:00:00Z';

const turno = (estadoOperativo: string, cambios: object = {}): object => ({
  id: 7,
  estado: 'RESERVADO',
  inicio: FUTURO,
  fin: '2030-03-04T12:45:00Z',
  personaId: 12,
  personaNombre: 'Perez, Ana',
  ofertaId: 14,
  ofertaNombre: 'Kinesiologia',
  profesionalId: 31,
  version: 4,
  operativo: { estadoOperativo, profesionalNombre: 'Lopez, Maria', espacioNombre: 'Box 1' },
  ...cambios,
});

const conContexto = (estadoOperativo: string, cambios: object = {}): object =>
  turno(estadoOperativo, {
    inicio: PASADO,
    operativo: {
      estadoOperativo,
      casoId: 9,
      planId: 5,
      numeroCaso: 2,
      sesionNumero: 3,
      sesionesPlanificadas: 10,
    },
    ...cambios,
  });

const DESTINO = {
  desde: '2030-03-05T13:00:00Z',
  hasta: '2030-03-05T13:45:00Z',
  profesionalId: 31,
  profesionalNombre: 'Lopez, Maria',
};

/**
 * Lo que se ve y se hace con un turno. Las acciones dependen del estado operativo, y esa tabla es lo
 * que evita ofrecer "Iniciar atención" sobre un turno cancelado o "Marcar ausente" antes de la hora.
 */
describe('DetalleDeTurnoPanel', () => {
  let httpMock: HttpTestingController;
  let cerrado: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DetalleDeTurnoPanel],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    cerrado = 0;
    // "Ya empezó" se decide contra el reloj: sin fijarlo, este spec vencería el día que llegue FUTURO.
    fijarReloj('2026-01-01T12:00:00Z');
  });

  afterEach(() => {
    soltarReloj();
    httpMock.verify();
  });

  describe('las acciones dependen del estado', () => {
    const CASOS: readonly {
      readonly nombre: string;
      readonly leido: object;
      readonly hay: readonly string[];
      readonly noHay: readonly string[];
    }[] = [
      {
        nombre: 'reservado y futuro',
        leido: turno('RESERVADO'),
        hay: [
          'Paciente presente',
          'Confirmar',
          'Iniciar atención',
          'Reprogramar',
          'Cancelar turno',
        ],
        noHay: ['Marcar ausente', 'Buscar nuevo turno', 'Programar próxima sesión'],
      },
      {
        nombre: 'confirmado: ya no ofrece confirmar',
        leido: turno('CONFIRMADO', { estado: 'CONFIRMADO' }),
        hay: ['Paciente presente', 'Reprogramar', 'Cancelar turno'],
        noHay: ['Confirmar'],
      },
      {
        nombre: 'reservado y ya empezó: ausente sí, mover o cancelar no',
        leido: turno('RESERVADO', { inicio: PASADO }),
        hay: ['Paciente presente', 'Marcar ausente'],
        noHay: ['Reprogramar', 'Cancelar turno'],
      },
      {
        nombre: 'presente',
        leido: turno('PRESENTE'),
        hay: ['Iniciar atención', 'Cancelar turno'],
        noHay: ['Paciente presente', 'Reprogramar', 'Marcar ausente'],
      },
      {
        nombre: 'en atención',
        leido: turno('EN_ATENCION', { inicio: PASADO }),
        hay: ['Abrir la atención'],
        noHay: ['Iniciar atención', 'Reprogramar', 'Cancelar turno', 'Marcar ausente'],
      },
      {
        nombre: 'atendido',
        leido: turno('ATENDIDO', { inicio: PASADO }),
        hay: ['Programar próxima sesión', 'Ver la atención'],
        noHay: ['Iniciar atención', 'Paciente presente', 'Cancelar turno'],
      },
      {
        nombre: 'cancelado: no se puede iniciar la atención',
        leido: turno('CANCELADO', { estado: 'CANCELADO', motivoCancelacion: 'Enfermedad' }),
        hay: ['Buscar nuevo turno'],
        noHay: ['Iniciar atención', 'Paciente presente', 'Reprogramar', 'Cancelar turno'],
      },
      {
        nombre: 'ausente',
        leido: turno('AUSENTE', { estado: 'AUSENTE', inicio: PASADO }),
        hay: ['Buscar nuevo turno'],
        noHay: ['Iniciar atención', 'Marcar ausente'],
      },
      {
        nombre: 'se retiró',
        leido: turno('RETIRADO', { inicio: PASADO }),
        // Si vuelve, la atención se puede abrir igual: es lo que le dice el aviso de recepción.
        hay: ['Buscar nuevo turno', 'Iniciar atención'],
        noHay: ['Marcar ausente', 'Reprogramar', 'Cancelar turno'],
      },
      {
        // U-21: el retiro no cierra la reserva, y cancelar es lo que libera el lugar. Ausencia y mover
        // dan 409: la llegada consta.
        nombre: 'se retiró antes de la hora: se puede cancelar, y marcar ausente o mover no',
        leido: turno('RETIRADO'),
        hay: ['Buscar nuevo turno', 'Cancelar turno'],
        noHay: ['Marcar ausente', 'Reprogramar'],
      },
      {
        // Lo que manda es la version, y sin ella no hay forma honesta de pedir estas tres.
        nombre: 'sin versión no ofrece lo que la lleva: inventarla sería prometer un 409',
        leido: turno('RESERVADO', { version: undefined }),
        hay: ['Paciente presente', 'Confirmar'],
        noHay: ['Reprogramar', 'Cancelar turno', 'Marcar ausente'],
      },
    ];

    for (const caso of CASOS) {
      it(caso.nombre, async () => {
        const fixture = await abierto(caso.leido);
        const rotulos = botones(fixture);

        caso.hay.forEach((rotulo) => expect(rotulos, rotulo).toContain(rotulo));
        caso.noHay.forEach((rotulo) => expect(rotulos, rotulo).not.toContain(rotulo));
      });
    }

    it('sin permisos de operar se puede mirar, y nada más', async () => {
      const fixture = await abierto(turno('RESERVADO'), []);

      expect(botones(fixture)).toEqual(expect.arrayContaining(['Ver historial', 'Ver paciente']));
      for (const rotulo of [
        'Paciente presente',
        'Iniciar atención',
        'Reprogramar',
        'Cancelar turno',
      ]) {
        expect(botones(fixture)).not.toContain(rotulo);
      }
      // No esconde que es de lectura.
      expect(texto(fixture)).toContain('necesita permiso de gestión de turnos');
    });

    it('con permiso no explica nada', async () => {
      const fixture = await abierto(turno('RESERVADO'));
      expect(texto(fixture)).not.toContain('necesita permiso');
    });

    it('un turno ya caído no dice que le falte permiso a nadie', async () => {
      const fixture = await abierto(turno('CANCELADO', { estado: 'CANCELADO' }), []);
      expect(texto(fixture)).not.toContain('necesita permiso');
    });

    it('el documento acompaña al nombre: desambigua homónimos', async () => {
      const fixture = await abierto(turno('RESERVADO', { documento: 'DNI 27888999' }));
      expect(raiz(fixture).querySelector('.panel-lateral__subtitulo')?.textContent).toBe(
        'Perez, Ana · DNI 27888999',
      );
    });

    it('muestra el motivo de una cancelación y de un sobreturno', async () => {
      const fixture = await abierto(
        turno('CANCELADO', {
          motivoCancelacion: 'Enfermedad',
          operativo: {
            estadoOperativo: 'CANCELADO',
            sobreturno: true,
            sobreturnoMotivo: 'Urgencia',
          },
        }),
      );

      expect(texto(fixture)).toContain('Motivo: Enfermedad');
      expect(texto(fixture)).toContain('Sobreturno: Urgencia');
    });

    it('un retiro muestra su motivo y explica por qué no se puede mover ni marcar ausente', async () => {
      const fixture = await abierto(
        turno('RETIRADO', {
          recepcion: { id: 9, estado: 'RETIRADO', motivoCierre: 'Se cansó de esperar', version: 3 },
        }),
      );

      expect(texto(fixture)).toContain('Motivo del retiro: Se cansó de esperar');
      expect(texto(fixture)).toContain('Se retiró sin ser atendido: la llegada consta');
    });
  });

  describe('el prepago avisa y no bloquea (E-8, DP-06)', () => {
    const PENDIENTE = { estado: 'PENDIENTE', importeSugerido: 15000, moneda: 'ARS' };

    it('antes de la llegada se lee "si se atiende como particular", y se puede operar igual', async () => {
      const fixture = await abierto(turno('RESERVADO', { prepago: PENDIENTE }));

      expect(texto(fixture)).toContain('Prepago pendiente si se atiende como particular');
      expect(texto(fixture)).toMatch(/sugerido \$\s?15\.000,00/);
      expect(botones(fixture)).toContain('Paciente presente');
    });

    it('con la llegada registrada ya no es condicional', async () => {
      const fixture = await abierto(
        turno('PRESENTE', {
          prepago: PENDIENTE,
          recepcion: { id: 9, estado: 'LLEGO', version: 1 },
        }),
      );

      expect(texto(fixture)).toContain('Prepago pendiente (sugerido');
      expect(texto(fixture)).not.toContain('si se atiende como particular');
    });

    it('un pendiente deja de valer si el turno se canceló; un registrado es para reintegrar', async () => {
      const pendiente = await abierto(
        turno('CANCELADO', { estado: 'CANCELADO', prepago: PENDIENTE }),
      );
      expect(texto(pendiente)).not.toContain('Prepago');

      const registrado = await abierto(
        turno('CANCELADO', {
          estado: 'CANCELADO',
          prepago: { estado: 'REGISTRADO', importe: 15000, moneda: 'ARS' },
        }),
      );
      expect(texto(registrado)).toContain('para un turno que no se va a atender');
    });

    it('sin prepago exigido no dice nada', async () => {
      const fixture = await abierto(turno('RESERVADO', { prepago: { estado: 'NO_EXIGIDO' } }));
      expect(texto(fixture)).not.toContain('Prepago');
    });
  });

  describe('la version es la de la ultima lectura', () => {
    /** Otra persona lo movio: la version del panel quedo vieja y el servidor la rechaza. */
    const VERSION_VIEJA = {
      type: 'https://akine.app/problems/concurrent-modification',
      status: 409,
      detail: 'Otra persona modificó este turno.',
    };

    it('después de operar, la siguiente transición manda la versión nueva', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Confirmar');
      httpMock.expectOne(`${TURNO}/confirmacion`).flush({ id: 7 });
      httpMock.expectOne(TURNO).flush(turno('CONFIRMADO', { estado: 'CONFIRMADO', version: 5 }));
      await asentar(fixture);

      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      clic(fixture, 'Cancelar turno');
      const pedido = httpMock.expectOne(`${TURNO}/cancelacion`);
      expect(pedido.request.body.expectedVersion).toBe(5);
      pedido.flush({ id: 7 });
      httpMock.expectOne((r) => r.url === COINCIDENCIAS).flush([]);
      httpMock.expectOne(TURNO).flush(turno('CANCELADO', { estado: 'CANCELADO', version: 6 }));
    });

    it('cancelar con una versión vieja rebota, se relee, avisa atrás y el reintento vale', async () => {
      const fixture = await abierto(turno('RESERVADO'));
      const flujo = TestBed.inject(FlujoDeTurnosStore);
      const cambios = flujo.cambios();

      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      clic(fixture, 'Cancelar turno');
      httpMock
        .expectOne(`${TURNO}/cancelacion`)
        .flush(VERSION_VIEJA, { status: 409, statusText: 'C' });
      httpMock.expectOne(TURNO).flush(turno('RESERVADO', { version: 9 }));
      await asentar(fixture);

      expect(texto(fixture)).toContain('Otra persona modificó este turno.');
      // Lo de atras tambien quedo viejo.
      expect(flujo.cambios()).toBe(cambios + 1);

      // Sigue en el formulario: se puede reintentar sin volver a cargar nada.
      clic(fixture, 'Cancelar turno');
      const reintento = httpMock.expectOne(`${TURNO}/cancelacion`);
      expect(reintento.request.body.expectedVersion).toBe(9);
      reintento.flush({ id: 7 });
      httpMock.expectOne((r) => r.url === COINCIDENCIAS).flush([]);
      httpMock.expectOne(TURNO).flush(turno('CANCELADO', { estado: 'CANCELADO', version: 10 }));
    });

    /**
     * El 409 sin salida: reprogramar rechazado no releia el turno, asi que el panel seguia mandando la
     * version vieja hasta que alguien lo cerrara.
     */
    it('reprogramar con una versión vieja también relee: el 409 tiene salida', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Reprogramar');
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [DESTINO] });
      await asentar(fixture);
      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      await asentar(fixture);

      clic(fixture, 'Reprogramar');
      httpMock
        .expectOne(`${TURNO}/reprogramacion`)
        .flush(VERSION_VIEJA, { status: 409, statusText: 'C' });
      httpMock.expectOne(TURNO).flush(turno('RESERVADO', { version: 9 }));
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [DESTINO] });
      await asentar(fixture);

      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      await asentar(fixture);
      clic(fixture, 'Reprogramar');
      const reintento = httpMock.expectOne(`${TURNO}/reprogramacion`);
      expect(reintento.request.body.expectedVersion).toBe(9);
      reintento.flush({ id: 7 });
      httpMock.expectOne(TURNO).flush(turno('RESERVADO', { version: 10 }));
    });

    it('marcar ausente con una versión vieja también', async () => {
      const fixture = await abierto(turno('RESERVADO', { inicio: PASADO }));

      clic(fixture, 'Marcar ausente');
      await asentar(fixture);
      clic(fixture, 'Registrar la ausencia');
      httpMock
        .expectOne(`${TURNO}/ausencia`)
        .flush(VERSION_VIEJA, { status: 409, statusText: 'C' });
      httpMock.expectOne(TURNO).flush(turno('RESERVADO', { inicio: PASADO, version: 9 }));
      await asentar(fixture);

      clic(fixture, 'Registrar la ausencia');
      const reintento = httpMock.expectOne(`${TURNO}/ausencia`);
      expect(reintento.request.body.expectedVersion).toBe(9);
      reintento.flush({ id: 7 });
      httpMock.expectOne(TURNO).flush(turno('AUSENTE', { inicio: PASADO, version: 10 }));
    });

    it('la lectura que vuelve tarde no pisa a la más nueva: se cancela', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      // Dos acciones seguidas, con la lectura de la primera todavia en vuelo.
      clic(fixture, 'Confirmar');
      httpMock.expectOne(`${TURNO}/confirmacion`).flush({ id: 7 });
      await asentar(fixture);
      clic(fixture, 'Paciente presente');
      httpMock.expectOne((r) => r.url === `${TURNO}/recepcion` && r.method === 'POST').flush({});
      await asentar(fixture);

      const lecturas = httpMock.match(TURNO);
      expect(lecturas.map((l) => l.cancelled)).toEqual([true, false]);
      lecturas[1].flush(turno('PRESENTE', { version: 6 }));
      await asentar(fixture);

      expect(texto(fixture)).toContain('Paciente presente');
    });

    it('si releer también falla, sigue a la vista el rechazo que hay que explicar', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Confirmar');
      httpMock
        .expectOne(`${TURNO}/confirmacion`)
        .flush(VERSION_VIEJA, { status: 409, statusText: 'C' });
      httpMock.expectOne(TURNO).flush(null, { status: 500, statusText: 'E' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Otra persona modificó este turno.');
    });
  });

  describe('los rechazos dicen qué hacer', () => {
    it('una transición no permitida muestra el motivo del servidor y vuelve al resumen', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      clic(fixture, 'Cancelar turno');
      httpMock.expectOne(`${TURNO}/cancelacion`).flush(
        {
          type: 'https://akine.app/problems/turno-transicion-no-permitida',
          status: 409,
          motivo: 'ya empezo; un turno pasado se marca ausente, no se cancela',
        },
        { status: 409, statusText: 'C' },
      );
      httpMock.expectOne(TURNO).flush(turno('RESERVADO', { inicio: PASADO, version: 5 }));
      await asentar(fixture);

      expect(texto(fixture)).toContain(
        'Lo que dijo el servidor: ya empezo; un turno pasado se marca ausente, no se cancela',
      );
      // El formulario ya no sirve: reintentar daria el mismo 409.
      expect(raiz(fixture).querySelector('#flujo-cancelar-motivo')).toBeNull();
      expect(botones(fixture)).toContain('Marcar ausente');
    });

    it('si mientras se reprogramaba otra persona lo canceló, el formulario no queda abierto', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Reprogramar');
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [DESTINO] });
      await asentar(fixture);
      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      await asentar(fixture);
      clic(fixture, 'Reprogramar');
      httpMock.expectOne(`${TURNO}/reprogramacion`).flush(
        {
          type: 'https://akine.app/problems/turno-transicion-no-permitida',
          status: 409,
          motivo: 'ya esta cancelado',
        },
        { status: 409, statusText: 'C' },
      );
      httpMock.expectOne(TURNO).flush(turno('CANCELADO', { estado: 'CANCELADO', version: 5 }));
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [] });
      await asentar(fixture);

      expect(raiz(fixture).querySelector('#flujo-reprogramar-motivo')).toBeNull();
      expect(texto(fixture)).toContain('ya esta cancelado');
      expect(botones(fixture)).toContain('Buscar nuevo turno');
    });

    it('si mientras se registraba la ausencia el paciente llegó, tampoco', async () => {
      const fixture = await abierto(turno('RESERVADO', { inicio: PASADO }));

      clic(fixture, 'Marcar ausente');
      await asentar(fixture);
      clic(fixture, 'Registrar la ausencia');
      httpMock.expectOne(`${TURNO}/ausencia`).flush(
        {
          type: 'https://akine.app/problems/turno-transicion-no-permitida',
          status: 409,
          motivo: 'el paciente llego',
        },
        { status: 409, statusText: 'C' },
      );
      httpMock.expectOne(TURNO).flush(turno('PRESENTE', { inicio: PASADO, version: 5 }));
      await asentar(fixture);

      expect(raiz(fixture).querySelector('#flujo-ausente-nota')).toBeNull();
      expect(botones(fixture)).toContain('Iniciar atención');
    });

    it('un turno con atención ofrece la atención, que es la única salida', async () => {
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      clic(fixture, 'Cancelar turno');
      httpMock
        .expectOne(`${TURNO}/cancelacion`)
        .flush(
          { type: 'https://akine.app/problems/turno-con-atencion', status: 409 },
          { status: 409, statusText: 'C' },
        );
      httpMock.expectOne(TURNO).flush(turno('EN_ATENCION', { inicio: PASADO }));
      await asentar(fixture);

      expect(texto(fixture)).not.toContain('No pudimos completar la operación');
      clic(fixture, 'Ver la atención clínica');
      expect(navegar).toHaveBeenCalledWith(['/atencion', 'turnos', 7]);
      expect(cerrado).toBe(1);
    });

    it('sin contexto de trabajo lleva a elegirlo', async () => {
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Confirmar');
      httpMock
        .expectOne(`${TURNO}/confirmacion`)
        .flush(
          { type: 'https://akine.app/problems/missing-tenant-context', status: 403 },
          { status: 403, statusText: 'F' },
        );
      httpMock.expectOne(TURNO).flush(turno('RESERVADO'));
      await asentar(fixture);

      clic(fixture, 'Elegir contexto de trabajo');
      expect(navegar).toHaveBeenCalledWith(['/seleccionar-contexto']);
    });

    it('"Volver" deja el rechazo atrás: era de lo que se abandona', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      clic(fixture, 'Cancelar turno');
      httpMock
        .expectOne(`${TURNO}/cancelacion`)
        .flush(
          { type: 'https://akine.app/problems/conflict', status: 409, detail: 'No' },
          { status: 409, statusText: 'C' },
        );
      httpMock.expectOne(TURNO).flush(turno('RESERVADO'));
      await asentar(fixture);
      expect(texto(fixture)).toContain('No se pudo completar la acción');

      clic(fixture, 'Volver');
      await asentar(fixture);
      expect(texto(fixture)).not.toContain('No se pudo completar la acción');
    });
  });

  describe('el motivo es obligatorio (DP-04)', () => {
    /** Elige "Otro" en el selector, que es el motivo que solo no dice nada. */
    async function elegirOtro(
      fixture: ComponentFixture<DetalleDeTurnoPanel>,
      selector: string,
    ): Promise<void> {
      const motivo = raiz(fixture).querySelector(selector) as HTMLSelectElement;
      motivo.value = 'Otro';
      motivo.dispatchEvent(new Event('change'));
      await asentar(fixture);
    }

    function escribir(
      fixture: ComponentFixture<DetalleDeTurnoPanel>,
      selector: string,
      valor: string,
    ): Promise<void> {
      const nota = raiz(fixture).querySelector(selector) as HTMLTextAreaElement;
      nota.value = valor;
      nota.dispatchEvent(new Event('input'));
      return asentar(fixture);
    }

    it('cancelar con "Otro" pide escribirlo: solo no es un motivo', async () => {
      const fixture = await abierto(turno('RESERVADO'));
      clic(fixture, 'Cancelar turno');
      await asentar(fixture);

      expect(texto(fixture)).toContain('Observación (opcional)');
      await elegirOtro(fixture, '#flujo-cancelar-motivo');
      expect(texto(fixture)).toContain('Observación (obligatoria)');
      expect(boton(fixture, 'Cancelar turno')?.disabled).toBe(true);

      // Espacios no alcanzan.
      await escribir(fixture, '#flujo-cancelar-nota', '   ');
      expect(boton(fixture, 'Cancelar turno')?.disabled).toBe(true);

      await escribir(fixture, '#flujo-cancelar-nota', 'Se mudó de ciudad');
      clic(fixture, 'Cancelar turno');
      const pedido = httpMock.expectOne(`${TURNO}/cancelacion`);
      expect(pedido.request.body.motivo).toBe('Otro: Se mudó de ciudad');
      pedido.flush({ id: 7 });
      httpMock.expectOne((r) => r.url === COINCIDENCIAS).flush([]);
      httpMock.expectOne(TURNO).flush(turno('CANCELADO'));
    });

    it('reprogramar con "Otro" también, y la observación viaja con el motivo', async () => {
      const fixture = await abierto(turno('RESERVADO'));
      clic(fixture, 'Reprogramar');
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [DESTINO] });
      await asentar(fixture);
      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      await asentar(fixture);

      await elegirOtro(fixture, '#flujo-reprogramar-motivo');
      expect(boton(fixture, 'Reprogramar')?.disabled).toBe(true);
      await escribir(fixture, '#flujo-reprogramar-nota', 'Llega más tarde');

      clic(fixture, 'Reprogramar');
      const pedido = httpMock.expectOne(`${TURNO}/reprogramacion`);
      expect(pedido.request.body.motivo).toBe('Otro: Llega más tarde');
      pedido.flush({ id: 7 });
      httpMock.expectOne(TURNO).flush(turno('RESERVADO', { version: 5 }));
    });

    it('lo escrito en una operación no aparece en la siguiente', async () => {
      const fixture = await abierto(turno('RESERVADO'));
      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      await escribir(fixture, '#flujo-cancelar-nota', 'Para otra cosa');
      clic(fixture, 'Volver');
      await asentar(fixture);

      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      expect(
        (raiz(fixture).querySelector('#flujo-cancelar-nota') as HTMLTextAreaElement).value,
      ).toBe('');
    });

    it('la ausencia no lo exige: el contrato lo declara opcional', async () => {
      const fixture = await abierto(turno('RESERVADO', { inicio: PASADO }));
      clic(fixture, 'Marcar ausente');
      await asentar(fixture);

      expect(boton(fixture, 'Registrar la ausencia')?.disabled).toBe(false);
      clic(fixture, 'Registrar la ausencia');
      const pedido = httpMock.expectOne(`${TURNO}/ausencia`);
      expect(pedido.request.body).toEqual({ expectedVersion: 4 });
      pedido.flush({ id: 7 });
      httpMock.expectOne(TURNO).flush(turno('AUSENTE', { inicio: PASADO }));
    });
  });

  describe('la zona de la sede', () => {
    /** 12:00Z son las 09:00 en Cordoba. */
    const CORDOBA = 'America/Argentina/Cordoba';

    it('si todavía no se conoce lo rotula UTC, y se corrige sola cuando llega', async () => {
      const fixture = await abierto(turno('RESERVADO'));
      const titulo = (): string =>
        raiz(fixture).querySelector('.flujo__resumen-titulo')?.textContent ?? '';
      expect(titulo()).toContain('12:00 a 12:45 (UTC)');

      // Entrando por la direccion del turno la zona llega despues de abrir el panel.
      TestBed.inject(DiaDeLaSede).cargar();
      httpMock
        .expectOne((r) => r.url === '/api/v1/organizations/1/consultorios')
        .flush({ content: [{ id: 3, timezone: CORDOBA }] });
      await asentar(fixture);

      expect(titulo()).toContain('09:00 a 09:45');
      expect(titulo()).not.toContain('UTC');
    });
  });

  describe('acciones de un paso', () => {
    it('"Paciente presente" se ejecuta directo, avisa y relee', async () => {
      const fixture = await abierto(turno('RESERVADO'));
      const flujo = TestBed.inject(FlujoDeTurnosStore);
      const cambios = flujo.cambios();

      clic(fixture, 'Paciente presente');
      const llegada = httpMock.expectOne(
        (r) => r.url === `${TURNO}/recepcion` && r.method === 'POST',
      );
      llegada.flush({ id: 1 });
      httpMock.expectOne(TURNO).flush(turno('PRESENTE'));
      await asentar(fixture);

      expect(flujo.cambios()).toBe(cambios + 1);
      expect(avisos()).toEqual(['Paciente marcado como presente.']);
      expect(texto(fixture)).toContain('Paciente presente');
      expect(botones(fixture)).not.toContain('Paciente presente');
    });

    it('un rechazo se muestra con su motivo y la pantalla se corrige con lo que dice el servidor', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Confirmar');
      httpMock.expectOne(`${TURNO}/confirmacion`).flush(
        {
          type: 'https://akine.app/problems/turno-transicion-no-permitida',
          status: 409,
          motivo: 'Ya está cancelado',
        },
        { status: 409, statusText: 'C' },
      );
      httpMock.expectOne(TURNO).flush(turno('CANCELADO'));
      await asentar(fixture);

      expect(texto(fixture)).toContain('No se pudo completar la acción');
      expect(texto(fixture)).toContain('Ya está cancelado');
      expect(botones(fixture)).toContain('Buscar nuevo turno');
    });

    it('la atención es otra pantalla: el turno solo lleva hasta ahí y el panel se cierra', async () => {
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = await abierto(turno('PRESENTE'));

      clic(fixture, 'Iniciar atención');

      expect(navegar).toHaveBeenCalledWith(['/atencion', 'turnos', 7]);
      expect(cerrado).toBe(1);
    });

    it('"Programar próxima sesión" abre el flujo con todo lo que el turno ya sabe', async () => {
      const fixture = await abierto(conContexto('ATENDIDO'));

      clic(fixture, 'Programar próxima sesión');

      expect(TestBed.inject(FlujoDeTurnosStore).solicitud()).toEqual({
        tipo: 'nuevo',
        contexto: {
          origen: 'TURNO_ANTERIOR',
          personaId: 12,
          ofertaId: 14,
          profesionalId: 31,
          casoId: 9,
          planId: 5,
        },
      });
    });

    it('"Más acciones" lleva al paciente, al caso, al plan y a la serie', async () => {
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = await abierto(conContexto('ATENDIDO', { serieId: 40 }));

      clic(fixture, 'Ver paciente');
      expect(navegar).toHaveBeenLastCalledWith(['/pacientes', 12]);
      clic(fixture, 'Ver caso');
      expect(navegar).toHaveBeenLastCalledWith(['/historia-clinica', 'personas', 12, 'casos', 9]);
      clic(fixture, 'Ver plan');
      expect(navegar).toHaveBeenLastCalledWith([
        '/historia-clinica',
        'personas',
        12,
        'casos',
        9,
        'plan',
      ]);
      clic(fixture, 'Ver la serie');
      expect(navegar).toHaveBeenLastCalledWith(['/agenda', 'series', 40]);
      expect(cerrado).toBe(4);
    });

    it('sin caso ni plan no ofrece ir a ellos', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      expect(botones(fixture)).not.toContain('Ver caso');
      expect(botones(fixture)).not.toContain('Ver plan');
      expect(botones(fixture)).not.toContain('Ver la serie');
    });
  });

  describe('reprogramar', () => {
    it('es el mismo turno: elige un horario, manda motivo y versión, y vuelve al resumen', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Reprogramar');
      const busqueda = httpMock.expectOne(BUSQUEDA);
      expect(busqueda.request.body).toEqual({ ofertaId: 14, profesionalId: 31, limite: 12 });
      busqueda.flush({
        timezone: 'America/Argentina/Cordoba',
        horarios: [DESTINO],
        truncado: true,
      });
      await asentar(fixture);

      expect(boton(fixture, 'Reprogramar')?.disabled).toBe(true);

      clic(fixture, 'Ver más horarios');
      const mas = httpMock.expectOne(BUSQUEDA);
      expect(mas.request.body.limite).toBe(24);
      mas.flush({ timezone: 'America/Argentina/Cordoba', horarios: [DESTINO] });
      await asentar(fixture);

      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      await asentar(fixture);
      const motivo = raiz(fixture).querySelector('#flujo-reprogramar-motivo') as HTMLSelectElement;
      motivo.value = 'Solicitud del profesional';
      motivo.dispatchEvent(new Event('change'));
      await asentar(fixture);

      clic(fixture, 'Reprogramar');
      const pedido = httpMock.expectOne(`${TURNO}/reprogramacion`);
      expect(pedido.request.body).toEqual({
        inicio: DESTINO.desde,
        profesionalId: 31,
        motivo: 'Solicitud del profesional',
        expectedVersion: 4,
      });
      pedido.flush({ id: 7 });
      httpMock.expectOne(TURNO).flush(turno('RESERVADO', { inicio: DESTINO.desde, version: 5 }));
      await asentar(fixture);

      expect(avisos()).toEqual(['Turno reprogramado correctamente.']);
      expect(raiz(fixture).querySelector('#flujo-reprogramar-motivo')).toBeNull();
    });

    it('si el horario se fue lo dice, suelta la elección y vuelve a buscar', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Reprogramar');
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [DESTINO] });
      await asentar(fixture);
      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      await asentar(fixture);

      clic(fixture, 'Reprogramar');
      httpMock
        .expectOne(`${TURNO}/reprogramacion`)
        .flush(
          { type: 'https://akine.app/problems/slot-no-disponible', status: 409 },
          { status: 409, statusText: 'C' },
        );
      httpMock.expectOne(TURNO).flush(turno('RESERVADO'));
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [] });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Ese horario dejo de estar disponible');
      expect(texto(fixture)).toContain('No hay horarios disponibles con este profesional.');
      expect(boton(fixture, 'Reprogramar')?.disabled).toBe(true);
    });

    it('"Volver" regresa al resumen sin tocar nada', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Reprogramar');
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [] });
      await asentar(fixture);

      clic(fixture, 'Volver');
      await asentar(fixture);
      expect(botones(fixture)).toContain('Paciente presente');
    });

    it('se puede pasar a otro profesional: viaja el del horario elegido', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Reprogramar');
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [] });
      await asentar(fixture);

      const profesional = raiz(fixture).querySelector(
        '#flujo-reprogramar-profesional',
      ) as HTMLSelectElement;
      expect(Array.from(profesional.options).map((o) => o.text.trim())).toEqual([
        'Lopez, Maria',
        'Cualquier profesional',
      ]);
      profesional.value = '';
      profesional.dispatchEvent(new Event('change'));
      const sinFiltro = httpMock.expectOne(BUSQUEDA);
      expect(sinFiltro.request.body.profesionalId).toBeUndefined();
      sinFiltro.flush({
        horarios: [{ ...DESTINO, profesionalId: 77, profesionalNombre: 'Ruiz, Pablo' }],
      });
      await asentar(fixture);

      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      await asentar(fixture);
      clic(fixture, 'Reprogramar');
      const pedido = httpMock.expectOne(`${TURNO}/reprogramacion`);
      expect(pedido.request.body.profesionalId).toBe(77);
      pedido.flush({ id: 7 });
      httpMock.expectOne(TURNO).flush(turno('RESERVADO', { profesionalId: 77, version: 5 }));
    });

    it('volver al profesional del turno lo busca de nuevo, y cambiar suelta lo elegido', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Reprogramar');
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [DESTINO] });
      await asentar(fixture);
      (raiz(fixture).querySelector('.horario') as HTMLButtonElement).click();
      await asentar(fixture);
      expect(boton(fixture, 'Reprogramar')?.disabled).toBe(false);

      const profesional = raiz(fixture).querySelector(
        '#flujo-reprogramar-profesional',
      ) as HTMLSelectElement;
      profesional.value = '31';
      profesional.dispatchEvent(new Event('change'));
      const conFiltro = httpMock.expectOne(BUSQUEDA);
      expect(conFiltro.request.body.profesionalId).toBe(31);
      conFiltro.flush({ horarios: [DESTINO] });
      await asentar(fixture);

      expect(boton(fixture, 'Reprogramar')?.disabled).toBe(true);
    });

    it('se puede buscar desde otro día, y arranca sin fecha', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Reprogramar');
      const inicial = httpMock.expectOne(BUSQUEDA);
      expect(inicial.request.body.desde).toBeUndefined();
      inicial.flush({ horarios: [DESTINO] });
      await asentar(fixture);

      const desde = raiz(fixture).querySelector('#flujo-reprogramar-desde') as HTMLInputElement;
      desde.value = '2030-04-01';
      desde.dispatchEvent(new Event('change'));
      const pedido = httpMock.expectOne(BUSQUEDA);
      expect(pedido.request.body.desde).toBe('2030-04-01');
      expect(pedido.request.body.limite).toBe(12);
      pedido.flush({ horarios: [] });
      await asentar(fixture);
    });

    it('con cualquier profesional, el vacío no habla de "este profesional"', async () => {
      const fixture = await abierto(turno('RESERVADO', { profesionalId: undefined }));

      clic(fixture, 'Reprogramar');
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [] });
      await asentar(fixture);

      // Una oferta sin profesional no tiene a quien elegir.
      expect(raiz(fixture).querySelector('#flujo-reprogramar-profesional')).toBeNull();
      expect(texto(fixture)).toContain('No hay horarios disponibles con estos criterios.');
    });

    it('si no se pudieron buscar horarios lo dice en su lugar, con Reintentar', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Reprogramar');
      httpMock.expectOne(BUSQUEDA).flush(null, { status: 500, statusText: 'E' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('No pudimos buscar horarios');
      expect(texto(fixture)).not.toContain('No hay horarios disponibles');

      clic(fixture, 'Reintentar');
      httpMock.expectOne(BUSQUEDA).flush({ horarios: [DESTINO] });
      await asentar(fixture);
      expect(raiz(fixture).querySelector('.horario')).not.toBeNull();
    });
  });

  describe('cancelar', () => {
    /** Abre "Cancelar turno", lo manda con esos datos y deja respondida la cancelación. */
    async function cancelarCon(fixture: ComponentFixture<DetalleDeTurnoPanel>): Promise<void> {
      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      const origen = raiz(fixture).querySelector('#flujo-cancelar-origen') as HTMLSelectElement;
      origen.value = 'PROFESIONAL';
      origen.dispatchEvent(new Event('change'));
      const motivo = raiz(fixture).querySelector('#flujo-cancelar-motivo') as HTMLSelectElement;
      motivo.value = 'Enfermedad';
      motivo.dispatchEvent(new Event('change'));
      const nota = raiz(fixture).querySelector('#flujo-cancelar-nota') as HTMLTextAreaElement;
      nota.value = ' Avisó por teléfono ';
      nota.dispatchEvent(new Event('input'));
      await asentar(fixture);

      clic(fixture, 'Cancelar turno');
      const pedido = httpMock.expectOne(`${TURNO}/cancelacion`);
      expect(pedido.request.body).toEqual({
        motivo: 'Enfermedad: Avisó por teléfono',
        origen: 'PROFESIONAL',
        expectedVersion: 4,
      });
      pedido.flush({ id: 7 });
    }

    it('manda quién cancela, el motivo y la versión; sin quien espere, avisa y relee', async () => {
      const fixture = await abierto(turno('RESERVADO'));
      const flujo = TestBed.inject(FlujoDeTurnosStore);
      const cambios = flujo.cambios();

      await cancelarCon(fixture);
      httpMock.expectOne((r) => r.url === COINCIDENCIAS).flush([]);
      httpMock.expectOne(TURNO).flush(turno('CANCELADO'));
      await asentar(fixture);

      expect(flujo.cambios()).toBe(cambios + 1);
      expect(avisos()).toEqual(['Turno cancelado.']);
      expect(botones(fixture)).toContain('Buscar nuevo turno');
    });

    it('sin observación manda solo el motivo', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      clic(fixture, 'Cancelar turno');
      const pedido = httpMock.expectOne(`${TURNO}/cancelacion`);
      expect(pedido.request.body.motivo).toBe('Solicitud del paciente');
      pedido.flush({ id: 7 });
      httpMock.expectOne((r) => r.url === COINCIDENCIAS).flush([]);
      httpMock.expectOne(TURNO).flush(turno('CANCELADO'));
    });

    it('el lugar se liberó: avisa quién lo esperaba y lleva a la lista de espera', async () => {
      const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = await abierto(turno('RESERVADO'));
      const flujo = TestBed.inject(FlujoDeTurnosStore);
      flujo.verTurno(7);

      await cancelarCon(fixture);
      const coincidencias = httpMock.expectOne((r) => r.url === COINCIDENCIAS);
      expect(coincidencias.request.params.get('turnoId')).toBe('7');
      coincidencias.flush([{ id: 1 }, { id: 2 }]);
      httpMock.expectOne(TURNO).flush(turno('CANCELADO'));
      await asentar(fixture);

      const [aviso] = TestBed.inject(AvisosStore).avisos();
      expect(aviso.titulo).toContain('2 pacientes en lista de espera');
      expect(aviso.duracion).toBeNull();

      aviso.accion?.ejecutar();
      expect(flujo.solicitud()).toBeNull();
      expect(navegar).toHaveBeenCalledWith(['/agenda', 'lista-de-espera'], {
        queryParams: { turno: 7 },
      });
    });

    it('con uno solo lo dice en singular', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      await cancelarCon(fixture);
      httpMock.expectOne((r) => r.url === COINCIDENCIAS).flush([{ id: 1 }]);
      httpMock.expectOne(TURNO).flush(turno('CANCELADO'));

      expect(avisos()[0]).toContain('Un paciente en lista de espera');
    });

    it('si no se puede leer quién espera, la cancelación igual se informa', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      await cancelarCon(fixture);
      httpMock
        .expectOne((r) => r.url === COINCIDENCIAS)
        .flush({ status: 500 }, { status: 500, statusText: 'E' });
      httpMock.expectOne(TURNO).flush(turno('CANCELADO'));

      expect(avisos()).toEqual(['Turno cancelado.']);
    });

    it('un turno con atención no se cancela: lo explica y relee', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Cancelar turno');
      await asentar(fixture);
      clic(fixture, 'Cancelar turno');
      httpMock
        .expectOne(`${TURNO}/cancelacion`)
        .flush(
          { type: 'https://akine.app/problems/turno-con-atencion', status: 409 },
          { status: 409, statusText: 'C' },
        );
      httpMock.expectOne(TURNO).flush(turno('EN_ATENCION'));
      await asentar(fixture);

      expect(texto(fixture)).toContain('ya tiene una atención clínica registrada');
    });
  });

  describe('marcar ausente', () => {
    it('con plan pregunta si consume una sesión, y el aviso ofrece buscar otro turno', async () => {
      const fixture = await abierto(conContexto('RESERVADO'));
      const flujo = TestBed.inject(FlujoDeTurnosStore);

      clic(fixture, 'Marcar ausente');
      await asentar(fixture);
      const [si] = Array.from(
        raiz(fixture).querySelectorAll<HTMLInputElement>('input[name="flujo-ausente-consume"]'),
      );
      si.checked = true;
      si.dispatchEvent(new Event('change'));
      const nota = raiz(fixture).querySelector('#flujo-ausente-nota') as HTMLTextAreaElement;
      nota.value = 'No avisó';
      nota.dispatchEvent(new Event('input'));
      await asentar(fixture);

      clic(fixture, 'Registrar la ausencia');
      const pedido = httpMock.expectOne(`${TURNO}/ausencia`);
      expect(pedido.request.body).toEqual({
        motivo: 'No avisó',
        consumeSesionDelPlan: true,
        expectedVersion: 4,
      });
      pedido.flush({ id: 7 });
      httpMock.expectOne(TURNO).flush(conContexto('AUSENTE'));
      await asentar(fixture);

      const [aviso] = TestBed.inject(AvisosStore).avisos();
      expect(aviso.titulo).toBe('Ausencia registrada.');
      aviso.accion?.ejecutar();
      expect(flujo.solicitud()).toMatchObject({
        tipo: 'nuevo',
        contexto: { origen: 'TURNO_ANTERIOR', casoId: 9, planId: 5 },
      });
    });

    it('sin plan no pregunta y no manda la decisión', async () => {
      const fixture = await abierto(turno('RESERVADO', { inicio: PASADO }));

      clic(fixture, 'Marcar ausente');
      await asentar(fixture);
      expect(raiz(fixture).querySelector('input[name="flujo-ausente-consume"]')).toBeNull();

      clic(fixture, 'Registrar la ausencia');
      const pedido = httpMock.expectOne(`${TURNO}/ausencia`);
      expect(pedido.request.body.consumeSesionDelPlan).toBeUndefined();
      // El motivo es opcional: vacío no viaja.
      expect(pedido.request.body.motivo).toBeUndefined();
      pedido.flush({ id: 7 });
      httpMock.expectOne(TURNO).flush(turno('AUSENTE', { inicio: PASADO, version: 5 }));
    });
  });

  describe('historial', () => {
    it('muestra qué pasó, cuándo, por qué y quién lo hizo', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Ver historial');
      await asentar(fixture);
      expect(texto(fixture)).toContain('Leyendo el historial');

      httpMock.expectOne(`${TURNO}/historial`).flush([
        {
          id: 1,
          tipo: 'RESERVA',
          ocurridoEn: '2030-03-01T12:00:00Z',
          actorNombre: 'Gomez, Luisa',
        },
        {
          id: 2,
          tipo: 'REPROGRAMACION',
          estadoAnterior: 'CONFIRMADO',
          estadoNuevo: 'RESERVADO',
          ocurridoEn: '2030-03-02T12:00:00Z',
          inicioAnterior: '2030-03-03T12:00:00Z',
          inicioNuevo: FUTURO,
          motivo: 'Solicitud del paciente',
          actorNombre: 'Ruiz, Pablo',
        },
        // Sin nombre resuelto se dice lo que hay, y sin cuenta tampoco se inventa.
        { id: 3, tipo: 'CONFIRMACION', ocurridoEn: '2030-03-02T13:00:00Z', actorCuentaId: 12 },
        { id: 4, tipo: 'CONFIRMACION', ocurridoEn: '2030-03-02T14:00:00Z' },
      ]);
      httpMock.expectOne(`${TURNO}/recepcion/historial`).flush([]);
      await asentar(fixture);

      const lista = raiz(fixture).querySelector('.flujo__historial')?.textContent ?? '';
      expect(lista).toContain('Se reservó el turno');
      expect(lista).toContain('Gomez, Luisa');
      expect(lista).toContain('Se movió a otro horario');
      expect(lista).toContain('Confirmado → Reservado');
      expect(lista).toContain('Solicitud del paciente');
      expect(lista).toContain('Ruiz, Pablo');
      expect(lista).toContain('De ');
      expect(lista).toContain('Cuenta #12');
      expect(lista).toContain('Sin registrar');
      expect(texto(fixture)).toContain('Turno #7');
      // Sin eventos de recepcion la seccion no se dibuja.
      expect(texto(fixture)).not.toContain('Historial de la recepción');

      clic(fixture, 'Volver');
      await asentar(fixture);
      expect(raiz(fixture).querySelector('.flujo__historial')).toBeNull();
    });

    it('muestra la recepción, que es otra máquina: también lo anulado (DP-16)', async () => {
      const fixture = await abierto(turno('RETIRADO'));

      clic(fixture, 'Ver historial');
      httpMock.expectOne(`${TURNO}/historial`).flush([]);
      httpMock.expectOne(`${TURNO}/recepcion/historial`).flush([
        { id: 1, tipo: 'LLEGADA', estadoNuevo: 'LLEGO', ocurridoEn: '2030-03-04T11:50:00Z' },
        {
          id: 2,
          tipo: 'ANULACION',
          estadoAnterior: 'LLEGO',
          estadoNuevo: 'ANULADA',
          motivo: 'Check-in al paciente equivocado',
          ocurridoEn: '2030-03-04T11:55:00Z',
        },
        {
          id: 3,
          tipo: 'RETIRO',
          estadoAnterior: 'LLEGO',
          estadoNuevo: 'RETIRADO',
          motivo: 'Se cansó de esperar',
          ocurridoEn: '2030-03-04T12:20:00Z',
        },
      ]);
      await asentar(fixture);

      const seccion = raiz(fixture).querySelector(
        'section[aria-labelledby="flujo-historial-recepcion"]',
      );
      expect(seccion?.textContent).toContain('Historial de la recepción');
      expect(seccion?.textContent).toContain('Llegada registrada');
      expect(seccion?.textContent).toContain('Llegada anulada');
      expect(seccion?.textContent).toContain('Check-in al paciente equivocado');
      expect(seccion?.textContent).toContain('Se retiro sin ser atendido');
      expect(seccion?.textContent).toContain('Se cansó de esperar');
      // "Antes → despues": sin el enum crudo.
      expect(seccion?.textContent?.replace(/\s+/g, ' ')).toContain('Llegó → Se retiró');
      expect(seccion?.textContent).not.toContain('RETIRADO');
    });

    it('sin cambios lo dice, en vez de quedarse leyendo para siempre', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Ver historial');
      httpMock.expectOne(`${TURNO}/historial`).flush([]);
      httpMock.expectOne(`${TURNO}/recepcion/historial`).flush([]);
      await asentar(fixture);

      expect(texto(fixture)).toContain('Todavía no hay cambios para mostrar.');
      expect(texto(fixture)).not.toContain('Leyendo el historial');
    });

    it('si no se puede leer lo dice en su lugar, con Reintentar', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Ver historial');
      httpMock
        .expectOne(`${TURNO}/historial`)
        .flush(
          { type: 'https://akine.app/problems/forbidden', status: 403 },
          { status: 403, statusText: 'F' },
        );
      httpMock.expectOne(`${TURNO}/recepcion/historial`).flush([]);
      await asentar(fixture);

      expect(texto(fixture)).toContain('No pudimos leer el historial del turno');
      expect(texto(fixture)).toContain('No tenés permiso');
      expect(texto(fixture)).not.toContain('Leyendo el historial');

      clic(fixture, 'Reintentar');
      httpMock
        .expectOne(`${TURNO}/historial`)
        .flush([{ id: 1, tipo: 'RESERVA', ocurridoEn: '2030-03-01T12:00:00Z' }]);
      httpMock.expectOne(`${TURNO}/recepcion/historial`).flush([]);
      await asentar(fixture);

      expect(texto(fixture)).toContain('Se reservó el turno');
      expect(texto(fixture)).not.toContain('No pudimos leer');
    });

    it('si falla solo el de la recepción, el del turno se ve igual', async () => {
      const fixture = await abierto(turno('RESERVADO'));

      clic(fixture, 'Ver historial');
      httpMock
        .expectOne(`${TURNO}/historial`)
        .flush([{ id: 1, tipo: 'RESERVA', ocurridoEn: '2030-03-01T12:00:00Z' }]);
      httpMock
        .expectOne(`${TURNO}/recepcion/historial`)
        .flush(null, { status: 500, statusText: 'E' });
      await asentar(fixture);

      expect(texto(fixture)).toContain('Se reservó el turno');
      expect(texto(fixture)).not.toContain('Historial de la recepción');
    });

    it(
      'con el "?" de cada sección no tiene violaciones de accesibilidad',
      async () => {
        const fixture = await abierto(turno('RETIRADO'));

        clic(fixture, 'Ver historial');
        httpMock
          .expectOne(`${TURNO}/historial`)
          .flush([{ id: 1, tipo: 'RESERVA', ocurridoEn: '2030-03-01T12:00:00Z' }]);
        httpMock
          .expectOne(`${TURNO}/recepcion/historial`)
          .flush([
            { id: 1, tipo: 'LLEGADA', estadoNuevo: 'LLEGO', ocurridoEn: '2030-03-04T11:50:00Z' },
          ]);
        await asentar(fixture);

        await esperarSinViolaciones(raiz(fixture));
      },
      TIMEOUT_AXE,
    );
  });

  describe('si el turno no se puede leer', () => {
    it('no existe o es de otra sede: lo dice y no dibuja acciones', async () => {
      const fixture = await montar();

      expect(texto(fixture)).toContain('Leyendo el turno');
      httpMock
        .expectOne(TURNO)
        .flush(
          { type: 'https://akine.app/problems/not-found', status: 404 },
          { status: 404, statusText: 'N' },
        );
      await asentar(fixture);

      expect(texto(fixture)).toContain('No pudimos abrir el turno');
      expect(texto(fixture)).toContain('Este turno no existe, o es de otra sede.');
      // Volver a pedirlo daria lo mismo; solo queda el boton de cerrar el panel.
      expect(botones(fixture)).toEqual(['Cerrar el panel']);
    });

    it('sin red ofrece reintentar, y reintentar lo abre', async () => {
      const fixture = await montar();

      httpMock.expectOne(TURNO).error(new ProgressEvent('error'));
      await asentar(fixture);
      expect(texto(fixture)).toContain('No se pudo contactar al servidor');

      clic(fixture, 'Reintentar');
      await asentar(fixture);
      expect(texto(fixture)).not.toContain('No pudimos abrir el turno');
      httpMock.expectOne(TURNO).flush(turno('RESERVADO'));
      await asentar(fixture);

      expect(botones(fixture)).toContain('Paciente presente');
    });
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await abierto(conContexto('RESERVADO', { serieId: 40 }));
      await esperarSinViolaciones(raiz(fixture));
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------

  async function montar(
    permisos: readonly string[] = [PERMISO_TURNO_MANAGE, PERMISO_SESION_REGISTER, PERMISO_HC_READ],
  ): Promise<ComponentFixture<DetalleDeTurnoPanel>> {
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    TestBed.inject(PermissionsStore).cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: permisos });

    const fixture = TestBed.createComponent(DetalleDeTurnoPanel);
    fixture.componentRef.setInput('turnoId', 7);
    fixture.componentInstance.cerrar.subscribe(() => cerrado++);
    fixture.detectChanges();
    return fixture;
  }

  async function abierto(
    leido: object,
    permisos?: readonly string[],
  ): Promise<ComponentFixture<DetalleDeTurnoPanel>> {
    const fixture = await montar(permisos);
    httpMock.expectOne(TURNO).flush(leido);
    await asentar(fixture);
    return fixture;
  }

  function avisos(): readonly string[] {
    return TestBed.inject(AvisosStore)
      .avisos()
      .map((aviso) => aviso.titulo);
  }

  function raiz(fixture: ComponentFixture<DetalleDeTurnoPanel>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function texto(fixture: ComponentFixture<DetalleDeTurnoPanel>): string {
    return (raiz(fixture).textContent ?? '').replace(/\s+/g, ' ');
  }

  function botones(fixture: ComponentFixture<DetalleDeTurnoPanel>): readonly string[] {
    return Array.from(raiz(fixture).querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
  }

  function boton(
    fixture: ComponentFixture<DetalleDeTurnoPanel>,
    rotulo: string,
  ): HTMLButtonElement | undefined {
    return Array.from(raiz(fixture).querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === rotulo,
    );
  }

  function clic(fixture: ComponentFixture<DetalleDeTurnoPanel>, rotulo: string): void {
    const encontrado = boton(fixture, rotulo);
    if (encontrado === undefined) {
      throw new Error(`No está el botón "${rotulo}". Hay: ${botones(fixture).join(' | ')}`);
    }
    encontrado.click();
    fixture.detectChanges();
  }

  async function asentar(fixture: ComponentFixture<DetalleDeTurnoPanel>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }
});
