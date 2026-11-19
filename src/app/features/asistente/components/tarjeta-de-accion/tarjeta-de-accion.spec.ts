import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';

import {
  AccionPropuesta,
  AccionPropuestaTipoEnum,
} from '../../../../api/generated/model/accion-propuesta';
import { ConfirmarAccion } from '../../../../api/generated/model/confirmar-accion';
import {
  ResultadoDeAccion,
  ResultadoDeAccionEstadoEnum,
} from '../../../../api/generated/model/resultado-de-accion';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { DiaDeLaSede } from '../../../../core/services/dia-de-la-sede';
import { AsistenteApi } from '../../services/asistente-api';
import { TarjetaDeAccion } from './tarjeta-de-accion';

interface Confirmacion {
  readonly sede: number;
  readonly accionId: number;
  /** Tal como viaja: lo `undefined` no sale en el JSON. */
  readonly cuerpo: ConfirmarAccion;
}

const CONFIRMADA: ResultadoDeAccion = {
  estado: ResultadoDeAccionEstadoEnum.CONFIRMADA,
  texto: 'Cobro registrado.',
  detalles: [],
  enlace: '/pacientes/7',
};

function accion(parcial: Partial<AccionPropuesta>): AccionPropuesta {
  return {
    id: 10,
    tipo: AccionPropuestaTipoEnum.PAGO,
    titulo: 'Registrar un cobro',
    avisos: [],
    bloqueos: [],
    venceEn: '2999-01-01T00:00:00Z',
    ...parcial,
  };
}

function pago(parcial: Partial<AccionPropuesta> = {}): AccionPropuesta {
  return accion({
    pago: {
      personaId: 7,
      nombre: 'Ana Sintética',
      moneda: 'ARS',
      total: 1000,
      cajaAbierta: true,
      imputaciones: [
        { obligacionId: 1, concepto: 'Sesión de kinesiología', fecha: '2026-11-10', saldo: 600 },
        { obligacionId: 2, concepto: 'Clase de yoga', fecha: '2026-11-12', saldo: 300 },
      ].map((i, n) => ({ ...i, importe: n === 0 ? 600 : 300 })),
    },
    ...parcial,
  });
}

function asistencia(): AccionPropuesta {
  return accion({
    id: 20,
    tipo: AccionPropuestaTipoEnum.ASISTENCIA_CLASE,
    titulo: 'Tomar asistencia',
    asistencia: {
      clases: [
        {
          claseId: 1,
          titulo: 'Yoga',
          inicio: '2026-11-19T12:00:00Z',
          items: [
            { inscripcionId: 11, nombre: 'Ana Sintética', resultado: 'PRESENTE' },
            { inscripcionId: 12, nombre: 'Beto Sintético', resultado: 'PRESENTE' },
          ],
        },
        {
          claseId: 2,
          titulo: 'Pilates',
          inicio: '2026-11-19T15:00:00Z',
          items: [{ inscripcionId: 21, nombre: 'Carla Sintética', resultado: 'PRESENTE' }],
        },
      ],
    },
  });
}

function atencion(): AccionPropuesta {
  return accion({
    id: 30,
    tipo: AccionPropuestaTipoEnum.ATENCION,
    titulo: 'Registrar la atención',
    atencion: {
      personaId: 7,
      nombre: 'Ana Sintética',
      turnoId: 5,
      turnos: [{ id: 5, etiqueta: 'Hoy 10:00 · Kinesiología' }],
      cerrar: true,
      tratamientos: [
        { practicaId: 1, nombre: 'Ultrasonido' },
        { practicaId: 2, nombre: 'Magnetoterapia' },
        { texto: 'ventosas' },
      ],
    },
  });
}

function alta(): AccionPropuesta {
  return accion({
    id: 40,
    tipo: AccionPropuestaTipoEnum.PACIENTE_ALTA,
    titulo: 'Dar de alta a una persona',
    paciente: {
      tipoDocumento: 'DNI',
      datos: { nombre: 'Ana', apellido: 'Sintética', documento: '30111222' },
      posiblesDuplicados: [{ id: 99, etiqueta: 'Ana Sintetica · DNI 30111223' }],
    },
  });
}

function noVigente(): AkineHttpError {
  return new AkineHttpError(
    409,
    { type: 'https://akine.app/problems/accion-no-vigente', title: 'No vigente', status: 409 },
    false,
  );
}

describe('TarjetaDeAccion', () => {
  let confirmaciones: Confirmacion[];
  let descartes: number[];
  let siguiente: () => Observable<ResultadoDeAccion>;
  let fixture: ComponentFixture<TarjetaDeAccion>;

  beforeEach(async () => {
    confirmaciones = [];
    descartes = [];
    siguiente = () => of(CONFIRMADA);
    await TestBed.configureTestingModule({
      imports: [TarjetaDeAccion],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DiaDeLaSede, useValue: { zona: () => 'America/Argentina/Cordoba' } },
        {
          provide: AsistenteApi,
          useValue: {
            confirmarAccion: (sede: number, accionId: number, cuerpo: ConfirmarAccion) => {
              confirmaciones.push({
                sede,
                accionId,
                cuerpo: JSON.parse(JSON.stringify(cuerpo)) as ConfirmarAccion,
              });
              return siguiente();
            },
            descartarAccion: (_sede: number, accionId: number) => {
              descartes.push(accionId);
              return of(null);
            },
          },
        },
      ],
    }).compileComponents();
  });

  function montar(a: AccionPropuesta): void {
    fixture = TestBed.createComponent(TarjetaDeAccion);
    fixture.componentRef.setInput('accion', a);
    fixture.componentRef.setInput('consultorioId', 3);
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const texto = (): string => (el().textContent ?? '').replace(/\s+/g, ' ');

  function boton(nombre: string): HTMLButtonElement {
    const hallado = Array.from(el().querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').trim().startsWith(nombre),
    );
    if (!hallado) {
      throw new Error(`No hay botón "${nombre}"`);
    }
    return hallado;
  }

  /** El control por su etiqueta visible, como lo encuentra quien usa la pantalla. */
  function control<T extends HTMLElement>(etiqueta: string): T {
    const label = Array.from(el().querySelectorAll('label')).find((l) =>
      (l.textContent ?? '').trim().startsWith(etiqueta),
    );
    if (!label) {
      throw new Error(`No hay etiqueta "${etiqueta}"`);
    }
    const hallado = label.htmlFor
      ? el().querySelector<T>(`#${label.htmlFor}`)
      : label.querySelector<T>('input, select, textarea');
    if (!hallado) {
      throw new Error(`La etiqueta "${etiqueta}" no apunta a ningún control`);
    }
    return hallado;
  }

  function elegir(etiqueta: string, valor: string): void {
    const select = control<HTMLSelectElement>(etiqueta);
    select.value = valor;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribir(etiqueta: string, valor: string): void {
    const campo = control<HTMLInputElement | HTMLTextAreaElement>(etiqueta);
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function tildar(etiqueta: string, marcado: boolean): void {
    const casilla = control<HTMLInputElement>(etiqueta);
    casilla.checked = marcado;
    casilla.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function pulsar(nombre: string): void {
    boton(nombre).click();
    fixture.detectChanges();
  }

  describe('pago', () => {
    it('muestra lo entendido y no deja confirmar sin medio', () => {
      montar(pago());

      expect(texto()).toContain('Registrar un cobro');
      expect(texto()).toContain('Ana Sintética');
      expect(control<HTMLInputElement>('Monto (ARS)').value).toBe('1000');
      expect(control<HTMLSelectElement>('Medio de pago').value).toBe('');
      expect(control<HTMLInputElement>('Sesión de kinesiología').value).toBe('600');
      expect(control<HTMLInputElement>('Clase de yoga').value).toBe('300');
      expect(texto()).toContain('Queda como saldo a favor: $ 100');
      expect(boton('Confirmar').disabled).toBe(true);
      expect(texto()).toContain('Elegí el medio de pago.');

      elegir('Medio de pago', 'TRANSFERENCIA');

      expect(boton('Confirmar').disabled).toBe(false);
      expect(texto()).not.toContain('Elegí el medio de pago.');
    });

    it('envía sólo el bloque del pago, con lo editado y el anticipo calculado', () => {
      montar(pago());
      elegir('Medio de pago', 'TRANSFERENCIA');
      escribir('Monto (ARS)', '1200');
      escribir('Clase de yoga', '150');

      pulsar('Confirmar');

      expect(confirmaciones).toHaveLength(1);
      expect(confirmaciones[0].sede).toBe(3);
      expect(confirmaciones[0].accionId).toBe(10);
      expect(Object.keys(confirmaciones[0].cuerpo)).toEqual(['pago']);
      const enviado = confirmaciones[0].cuerpo.pago;
      expect(enviado?.total).toBe(1200);
      expect(enviado?.medio).toBe('TRANSFERENCIA');
      expect(enviado?.imputaciones?.map((i) => [i.obligacionId, i.importe])).toEqual([
        [1, 600],
        [2, 150],
      ]);
      expect(enviado?.anticipo).toBe(450);
    });

    it('con centavos no inventa decimales ni un exceso que no existe', () => {
      // 100,10 + 200,20 en coma flotante da 300,30000000000007.
      montar(pago());
      elegir('Medio de pago', 'TRANSFERENCIA');
      escribir('Sesión de kinesiología', '100.10');
      escribir('Clase de yoga', '200.20');
      escribir('Monto (ARS)', '300.30');

      expect(texto()).not.toContain('supera el monto');
      expect(texto()).not.toContain('saldo a favor');
      pulsar('Confirmar');
      expect(confirmaciones[0].cuerpo.pago?.anticipo).toBe(0);

      montar(pago());
      elegir('Medio de pago', 'TRANSFERENCIA');
      escribir('Monto (ARS)', '1000.10');
      escribir('Clase de yoga', '0.05');
      pulsar('Confirmar');
      expect(confirmaciones[1].cuerpo.pago?.anticipo).toBe(400.05);
    });

    it('confirmada: muestra el texto y el enlace, y ya no hay nada que tocar', () => {
      montar(pago());
      elegir('Medio de pago', 'EFECTIVO');
      pulsar('Confirmar');

      expect(el().querySelector('[role=status]')?.textContent).toContain('Cobro registrado.');
      const enlace = el().querySelector('a');
      expect(enlace?.textContent).toContain('Ver lo que se grabó');
      expect(enlace?.getAttribute('href')).toBe('/pacientes/7');
      expect(el().querySelectorAll('button, input, select')).toHaveLength(0);
    });

    it('rechazada: muestra el motivo y se puede corregir y volver a confirmar', () => {
      siguiente = () =>
        of({
          estado: ResultadoDeAccionEstadoEnum.RECHAZADA,
          texto: 'La deuda ya estaba saldada.',
          detalles: [],
        });
      montar(pago());
      elegir('Medio de pago', 'TRANSFERENCIA');
      pulsar('Confirmar');

      expect(el().querySelector('[role=alert]')?.textContent).toContain(
        'La deuda ya estaba saldada.',
      );
      expect(control<HTMLInputElement>('Monto (ARS)').matches(':disabled')).toBe(false);
      expect(control<HTMLSelectElement>('Medio de pago').value).toBe('TRANSFERENCIA');
      expect(boton('Confirmar').disabled).toBe(false);

      siguiente = () => of(CONFIRMADA);
      pulsar('Confirmar');
      expect(confirmaciones).toHaveLength(2);
      expect(texto()).toContain('Cobro registrado.');
      expect(texto()).not.toContain('La deuda ya estaba saldada.');
    });

    it('409 accion-no-vigente la deja vencida', () => {
      siguiente = () => throwError(() => noVigente());
      montar(pago());
      elegir('Medio de pago', 'TRANSFERENCIA');
      pulsar('Confirmar');

      expect(el().querySelector('[role=status]')?.textContent).toContain('venció');
      expect(el().querySelectorAll('button')).toHaveLength(0);
    });

    it('otro error deja la tarjeta abierta con el motivo', () => {
      siguiente = () => throwError(() => new AkineHttpError(0, null, true));
      montar(pago());
      elegir('Medio de pago', 'TRANSFERENCIA');
      pulsar('Confirmar');

      expect(el().querySelector('[role=alert]')?.textContent).toContain('Revisá tu conexión');
      expect(boton('Confirmar').disabled).toBe(false);
    });

    it('en efectivo con la caja cerrada no deja confirmar', () => {
      const a = pago();
      montar({ ...a, pago: { ...a.pago, cajaAbierta: false } });
      elegir('Medio de pago', 'EFECTIVO');

      expect(boton('Confirmar').disabled).toBe(true);
      expect(texto()).toContain('La caja de la sede está cerrada');
    });

    it('vence sola cuando pasa su hora', () => {
      vi.useFakeTimers();
      try {
        montar(pago({ venceEn: new Date(Date.now() + 20_000).toISOString() }));
        vi.advanceTimersByTime(31_000);
        fixture.detectChanges();
        expect(texto()).toContain('venció');
      } finally {
        fixture.destroy();
        vi.useRealTimers();
      }
    });
  });

  describe('asistencia con dos clases', () => {
    it('pide la clase, muestra sus inscriptos y manda el ausente', () => {
      montar(asistencia());

      expect(boton('Confirmar').disabled).toBe(true);
      expect(texto()).toContain('Elegí la clase.');
      expect(texto()).not.toContain('Ana Sintética');

      elegir('Clase', '1');

      expect(texto()).toContain('Ana Sintética');
      expect(texto()).toContain('Beto Sintético');
      expect(texto()).not.toContain('Carla Sintética');
      expect(control<HTMLSelectElement>('Beto Sintético').value).toBe('PRESENTE');
      expect(boton('Confirmar').disabled).toBe(false);

      elegir('Beto Sintético', 'AUSENTE');
      pulsar('Confirmar');

      expect(Object.keys(confirmaciones[0].cuerpo)).toEqual(['asistencia']);
      const enviada = confirmaciones[0].cuerpo.asistencia;
      expect(enviada?.claseId).toBe(1);
      const items = enviada?.clases?.find((c) => c.claseId === 1)?.items;
      expect(items?.map((i) => [i.inscripcionId, i.resultado])).toEqual([
        [11, 'PRESENTE'],
        [12, 'AUSENTE'],
      ]);
    });

    it('cambiar de clase muestra la otra lista con sus marcas', () => {
      montar(asistencia());
      elegir('Clase', '1');
      elegir('Clase', '2');

      expect(texto()).toContain('Carla Sintética');
      expect(texto()).not.toContain('Beto Sintético');
      expect(control<HTMLSelectElement>('Carla Sintética').value).toBe('PRESENTE');
    });

    it('sin nadie marcado no se confirma', () => {
      montar(asistencia());
      elegir('Clase', '2');
      elegir('Carla Sintética', '');

      expect(boton('Confirmar').disabled).toBe(true);
      expect(texto()).toContain('Marcá al menos a una persona.');
    });
  });

  describe('atención', () => {
    it('quitar un tratamiento lo saca del cuerpo', () => {
      montar(atencion());
      escribir('Nota de cierre', 'Evoluciona bien.');

      expect(texto()).toContain('«ventosas»');
      boton('Quitar Magnetoterapia').click();
      fixture.detectChanges();
      // Con un tratamiento sin reconocer no se puede cerrar: hay que quitarlo (o dejarla abierta).
      expect(boton('Confirmar').disabled).toBe(true);
      expect(texto()).toContain('no reconocidos');
      boton('Quitar ventosas').click();
      fixture.detectChanges();
      pulsar('Confirmar');

      expect(Object.keys(confirmaciones[0].cuerpo)).toEqual(['atencion']);
      const enviada = confirmaciones[0].cuerpo.atencion;
      expect(enviada?.tratamientos).toEqual([{ practicaId: 1, nombre: 'Ultrasonido' }]);
      expect(enviada?.nota).toBe('Evoluciona bien.');
      expect(enviada?.cerrar).toBe(true);
      expect(enviada?.turnoId).toBe(5);
    });

    it('para cerrar exige la nota; sin cerrar, no', () => {
      montar(atencion());

      boton('Quitar ventosas').click();
      fixture.detectChanges();

      expect(control<HTMLInputElement>('Cerrar la atención').checked).toBe(true);
      expect(boton('Confirmar').disabled).toBe(true);
      expect(texto()).toContain('Falta la nota de cierre.');

      tildar('Cerrar la atención', false);

      expect(boton('Confirmar').disabled).toBe(false);
      pulsar('Confirmar');
      expect(confirmaciones[0].cuerpo.atencion?.cerrar).toBe(false);
    });
  });

  describe('paciente', () => {
    it('el alta con parecidos exige la casilla', () => {
      montar(alta());

      expect(control<HTMLInputElement>('Nombre').value).toBe('Ana');
      expect(control<HTMLInputElement>('Documento (DNI)').value).toBe('30111222');
      expect(el().querySelector('a')?.getAttribute('href')).toBe('/pacientes/99');
      expect(boton('Confirmar').disabled).toBe(true);
      expect(texto()).toContain('Confirmá que es otra persona.');

      tildar('Es otra persona', true);
      escribir('Teléfono', ' 3515550000 ');

      expect(boton('Confirmar').disabled).toBe(false);
      pulsar('Confirmar');
      expect(Object.keys(confirmaciones[0].cuerpo)).toEqual(['paciente']);
      expect(confirmaciones[0].cuerpo.paciente?.confirmaPosibleDuplicado).toBe(true);
      expect(confirmaciones[0].cuerpo.paciente?.datos).toEqual({
        nombre: 'Ana',
        apellido: 'Sintética',
        documento: '30111222',
        telefono: '3515550000',
      });
    });

    it('el alta sin apellido no se confirma', () => {
      montar(alta());
      tildar('Es otra persona', true);
      escribir('Apellido', '  ');

      expect(boton('Confirmar').disabled).toBe(true);
      expect(texto()).toContain('Falta el nombre y el apellido.');
    });

    it('la edición muestra lo que había antes y no ofrece nombre ni apellido', () => {
      montar(
        accion({
          id: 41,
          tipo: AccionPropuestaTipoEnum.PACIENTE_EDICION,
          titulo: 'Cambiar datos de Ana Sintética',
          paciente: {
            personaId: 7,
            version: 2,
            tipoDocumento: 'DNI',
            datos: { telefono: '3515550000' },
            anterior: { telefono: '3514440000', email: 'ana@ejemplo.test' },
          },
        }),
      );

      expect(texto()).toContain('Antes: 3514440000');
      expect(texto()).toContain('Antes: ana@ejemplo.test');
      expect(Array.from(el().querySelectorAll('label')).map((l) => l.textContent?.trim())).toEqual([
        'Teléfono',
        'Correo',
        'Documento (DNI)',
        'Fecha de nacimiento',
      ]);
      expect(boton('Confirmar').disabled).toBe(false);

      escribir('Teléfono', '');
      expect(boton('Confirmar').disabled).toBe(true);
      expect(texto()).toContain('No hay ningún dato para cambiar.');
    });
  });

  describe('llegada', () => {
    it('se confirma tal cual', () => {
      montar(
        accion({
          id: 50,
          tipo: AccionPropuestaTipoEnum.LLEGADA,
          titulo: 'Registrar la llegada',
          llegada: {
            personaId: 7,
            turnoId: 5,
            nombre: 'Ana Sintética',
            hora: '2026-11-19T13:00:00Z',
          },
        }),
      );

      expect(texto()).toContain('Ana Sintética · turno de las');
      pulsar('Confirmar');
      expect(confirmaciones[0].cuerpo).toEqual({
        llegada: {
          personaId: 7,
          turnoId: 5,
          nombre: 'Ana Sintética',
          hora: '2026-11-19T13:00:00Z',
        },
      });
    });
  });

  describe('confirmar y descartar', () => {
    it('descartar avisa al servidor y deja la tarjeta descartada', () => {
      montar(pago());
      pulsar('Descartar');

      expect(descartes).toEqual([10]);
      expect(el().querySelector('[role=status]')?.textContent).toContain('Descartada');
      expect(el().querySelectorAll('button')).toHaveLength(0);
      expect(confirmaciones).toHaveLength(0);
    });

    it('un doble clic en Confirmar graba una sola vez y bloquea todo mientras se envía', () => {
      const respuesta = new Subject<ResultadoDeAccion>();
      siguiente = () => respuesta;
      montar(pago());
      elegir('Medio de pago', 'TRANSFERENCIA');

      const confirmar = boton('Confirmar');
      confirmar.click();
      confirmar.click();
      fixture.detectChanges();
      confirmar.click();
      boton('Descartar').click();

      expect(confirmaciones).toHaveLength(1);
      expect(descartes).toHaveLength(0);
      expect(boton('Grabando…').disabled).toBe(true);
      expect(boton('Descartar').disabled).toBe(true);
      for (const c of Array.from(el().querySelectorAll('fieldset input, fieldset select'))) {
        expect(c.matches(':disabled')).toBe(true);
      }

      respuesta.next(CONFIRMADA);
      respuesta.complete();
      fixture.detectChanges();
      expect(texto()).toContain('Cobro registrado.');
    });
  });

  describe('bloqueos del servidor', () => {
    it('se ven y no dejan confirmar aunque la tarjeta esté completa', () => {
      const a = pago({ bloqueos: ['La persona no tiene deudas en esta sede.'] });
      montar({ ...a, pago: { ...a.pago, medio: 'TRANSFERENCIA' } });

      expect(el().querySelector('[role=alert]')?.textContent).toContain(
        'La persona no tiene deudas en esta sede.',
      );
      const confirmar = boton('Confirmar');
      expect(confirmar.disabled).toBe(true);
      confirmar.click();
      expect(confirmaciones).toHaveLength(0);
      // Lo que describe al botón tiene que existir en el documento.
      const descrito = confirmar.getAttribute('aria-describedby');
      expect(descrito).not.toBeNull();
      expect(el().querySelector(`#${descrito}`)?.textContent).toContain('no tiene deudas');
      // Descartar sigue disponible.
      expect(boton('Descartar').disabled).toBe(false);
    });
  });

  describe('otra acción en la misma tarjeta', () => {
    it('reinicia el borrador', () => {
      montar(pago());
      elegir('Medio de pago', 'TRANSFERENCIA');
      escribir('Monto (ARS)', '5000');

      const otra = pago({ id: 11 });
      fixture.componentRef.setInput('accion', { ...otra, pago: { ...otra.pago, total: 900 } });
      fixture.detectChanges();

      expect(control<HTMLInputElement>('Monto (ARS)').value).toBe('900');
      expect(control<HTMLSelectElement>('Medio de pago').value).toBe('');
      expect(boton('Confirmar').disabled).toBe(true);

      elegir('Medio de pago', 'EFECTIVO');
      pulsar('Confirmar');
      expect(confirmaciones[0].accionId).toBe(11);
      expect(confirmaciones[0].cuerpo.pago?.total).toBe(900);
    });

    it('no hereda el estado ni el rechazo de la anterior', () => {
      siguiente = () =>
        of({ estado: ResultadoDeAccionEstadoEnum.RECHAZADA, texto: 'No se pudo.', detalles: [] });
      montar(pago());
      elegir('Medio de pago', 'TRANSFERENCIA');
      pulsar('Confirmar');
      expect(texto()).toContain('No se pudo.');

      fixture.componentRef.setInput('accion', pago({ id: 11 }));
      fixture.detectChanges();
      expect(texto()).not.toContain('No se pudo.');

      pulsar('Descartar');
      expect(texto()).toContain('Descartada');

      fixture.componentRef.setInput('accion', pago({ id: 12 }));
      fixture.detectChanges();
      expect(texto()).not.toContain('Descartada');
      expect(boton('Descartar').disabled).toBe(false);
    });
  });

  it('cada control tiene su etiqueta y cada botón su texto', () => {
    for (const a of [pago(), asistencia(), atencion(), alta()]) {
      montar(a);
      if (a.asistencia) {
        elegir('Clase', '1');
      }
      for (const c of Array.from(el().querySelectorAll('input, select, textarea'))) {
        const etiquetado =
          c.closest('label') !== null ||
          (c.id !== '' && el().querySelector(`label[for="${c.id}"]`) !== null);
        expect(etiquetado, `${a.tipo}: ${c.outerHTML.slice(0, 80)}`).toBe(true);
      }
      for (const b of Array.from(el().querySelectorAll('button'))) {
        expect((b.textContent ?? '').trim()).not.toBe('');
      }
      const ids = Array.from(el().querySelectorAll('[id]')).map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
