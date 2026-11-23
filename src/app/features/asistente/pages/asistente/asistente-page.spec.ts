import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { InterpretacionDtoIntencionEnum } from '../../../../api/generated/model/interpretacion-dto';
import {
  RespuestaAsistenteResponse,
  RespuestaAsistenteResponseResultadoEnum,
} from '../../../../api/generated/model/respuesta-asistente-response';
import { AkineHttpError } from '../../../../core/interceptors/error.interceptor';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { AsistenteApi, TurnoPrevio } from '../../services/asistente-api';
import { AsistentePage } from './asistente-page';

interface Pedido {
  readonly sede: number;
  readonly pregunta: string;
  readonly historial: readonly TurnoPrevio[];
  readonly personaId?: number;
}

function respuesta(parcial: Partial<RespuestaAsistenteResponse>): RespuestaAsistenteResponse {
  return {
    texto: 'Listo',
    interpretacion: { intencion: InterpretacionDtoIntencionEnum.AGENDA_DEL_DIA, periodo: 'HOY' },
    resultado: RespuestaAsistenteResponseResultadoEnum.RESPONDIDA,
    filas: [],
    opciones: [],
    advertencias: [],
    ...parcial,
  };
}

describe('AsistentePage', () => {
  let pedidos: Pedido[];
  let siguiente: () => Observable<RespuestaAsistenteResponse>;
  let fixture: ComponentFixture<AsistentePage>;

  beforeEach(async () => {
    pedidos = [];
    siguiente = () => of(respuesta({}));
    await TestBed.configureTestingModule({
      imports: [AsistentePage],
      providers: [
        provideRouter([]),
        {
          provide: AsistenteApi,
          useValue: {
            consultar: (
              sede: number,
              pregunta: string,
              historial: readonly TurnoPrevio[],
              personaId?: number,
            ) => {
              pedidos.push({ sede, pregunta, historial, personaId });
              return siguiente();
            },
          },
        },
      ],
    }).compileComponents();
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Centro',
      consultorioId: 3,
      consultorioName: 'Sede',
    });
    fixture = TestBed.createComponent(AsistentePage);
    fixture.detectChanges();
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  async function preguntar(texto: string): Promise<void> {
    const caja = el().querySelector('textarea') as HTMLTextAreaElement;
    caja.value = texto;
    caja.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (el().querySelector('button[type=submit]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('preguntaEnLaSedeActivaYMuestraElTextoYLosDatos', async () => {
    siguiente = () =>
      of(
        respuesta({
          texto: 'El lun 16/11 hay 1 turno en Sede.',
          filas: [
            {
              turnoId: 9,
              inicio: '2026-11-16T13:30:00Z',
              paciente: 'Acosta, Lautaro',
              estado: 'RESERVADO',
            },
          ],
          enlace: '/agenda/recepcion',
        }),
      );

    await preguntar('¿Quiénes vienen mañana?');

    expect(pedidos[0]).toEqual({
      sede: 3,
      pregunta: '¿Quiénes vienen mañana?',
      historial: [],
      personaId: undefined,
    });
    expect(el().textContent).toContain('El lun 16/11 hay 1 turno en Sede.');
    expect(el().querySelector('summary')?.textContent).toContain('Ver los datos (1)');
    const encabezados = [...el().querySelectorAll('th')].map((th) => th.textContent?.trim());
    expect(encabezados).toEqual(['Fecha y hora', 'Paciente', 'Estado']);
    expect(el().querySelector('a.asistente__chip')?.getAttribute('href')).toBe(
      '/agenda/recepcion',
    );
  });

  it('elSeguimientoMandaLaInterpretacionAnterior', async () => {
    const interpretacion = {
      intencion: InterpretacionDtoIntencionEnum.ASISTENCIA_PERSONA,
      persona: 'Juan',
      periodo: 'ESTA_SEMANA',
    };
    siguiente = () => of(respuesta({ interpretacion }));
    await preguntar('¿Juan vino esta semana?');
    await preguntar('¿y la semana pasada?');

    expect(pedidos[1].historial).toEqual([{ pregunta: '¿Juan vino esta semana?', interpretacion }]);
  });

  it('unaAclaracionReenviaLaMismaPreguntaConLaPersonaElegida', async () => {
    siguiente = () =>
      of(
        respuesta({
          texto: 'Encontré varias personas con "Juan". ¿Cuál?',
          resultado: RespuestaAsistenteResponseResultadoEnum.ACLARACION,
          opciones: [
            { personaId: 5, etiqueta: 'Pérez, Juan · DNI ***456' },
            { personaId: 6, etiqueta: 'Gómez, Juan · DNI ***789' },
          ],
        }),
      );
    await preguntar('¿Juan vino?');

    const opcion = [
      ...el().querySelectorAll('.asistente__opciones button'),
    ][1] as HTMLButtonElement;
    opcion.click();
    fixture.detectChanges();

    expect(pedidos[1].pregunta).toBe('¿Juan vino?');
    expect(pedidos[1].personaId).toBe(6);
    expect(el().textContent).toContain('Gómez, Juan · DNI ***789');
  });

  it('apagadoMuestraElEstadoVacioYDesactivaLaCaja', async () => {
    siguiente = () =>
      throwError(
        () =>
          new AkineHttpError(
            409,
            { type: 'https://akine.app/problems/asistente-deshabilitado' },
            false,
          ),
      );

    await preguntar('¿Quiénes vienen hoy?');

    expect(el().textContent).toContain('El asistente no está habilitado en este entorno.');
    expect((el().querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('unModeloCaidoDejaElErrorEnLaBurbuja', async () => {
    siguiente = () =>
      throwError(
        () =>
          new AkineHttpError(
            503,
            { type: 'https://akine.app/problems/asistente-no-disponible' },
            false,
          ),
      );

    await preguntar('¿Quiénes vienen hoy?');

    expect(el().querySelector('.asistente__burbuja--error')?.textContent).toContain(
      'no está disponible',
    );
  });
});
