import { ParticipanteOperativo } from '../../../api/generated/model/participante-operativo';
import {
  Marca,
  admiteAsistencia,
  armarLote,
  correccionesSinMotivo,
  etiquetaDeEstadoDeClase,
  etiquetaDeEstadoDeInscripcion,
  etiquetaDeEvento,
  etiquetaDeResultado,
  fechaHoraEnZona,
  horaEnZona,
  nombreDeParticipante,
  tieneLugar,
} from './etiquetas-de-asistencia';

const SIN_MARCAR: ParticipanteOperativo = {
  apellido: 'Gomez',
  nombre: 'Ana',
  inscripcion: { id: 1, estado: 'CONFIRMADA' },
};
const PRESENTE: ParticipanteOperativo = {
  apellido: 'Lopez',
  inscripcion: { id: 2, estado: 'ASISTIO' },
  asistencia: { id: 20, resultado: 'PRESENTE' },
};
const EN_ESPERA: ParticipanteOperativo = { inscripcion: { id: 3, estado: 'LISTA_ESPERA' } };

function marcas(...pares: [number, Marca][]): ReadonlyMap<number, Marca> {
  return new Map(pares);
}

describe('etiquetas-de-asistencia', () => {
  it('el lote lleva solo lo que cambia, y las correcciones con su motivo', () => {
    const lote = armarLote(
      [SIN_MARCAR, PRESENTE, EN_ESPERA],
      marcas(
        [1, { resultado: 'PRESENTE_TARDE', motivo: 'no viaja' }],
        [2, { resultado: 'AUSENTE', motivo: '  Se fue antes  ' }],
        [3, { resultado: 'PRESENTE', motivo: '' }],
      ),
    );
    expect(lote).toEqual([
      { inscripcionId: 1, resultado: 'PRESENTE_TARDE' },
      { inscripcionId: 2, resultado: 'AUSENTE', motivo: 'Se fue antes' },
    ]);
  });

  it('repetir lo registrado no viaja', () => {
    expect(armarLote([PRESENTE], marcas([2, { resultado: 'PRESENTE', motivo: '' }]))).toEqual([]);
  });

  it('detecta las correcciones sin motivo', () => {
    expect(
      correccionesSinMotivo(
        [SIN_MARCAR, PRESENTE],
        marcas(
          [1, { resultado: 'AUSENTE', motivo: '' }],
          [2, { resultado: 'AUSENTE', motivo: ' ' }],
        ),
      ),
    ).toEqual([2]);
  });

  it('solo se marca con la clase en curso o realizada, y con lugar', () => {
    expect(admiteAsistencia('EN_CURSO')).toBe(true);
    expect(admiteAsistencia('REALIZADA')).toBe(true);
    expect(admiteAsistencia('PROGRAMADA')).toBe(false);
    expect(tieneLugar(SIN_MARCAR)).toBe(true);
    expect(tieneLugar(EN_ESPERA)).toBe(false);
  });

  it('etiquetas y nombres', () => {
    expect(etiquetaDeResultado('PRESENTE_TARDE')).toBe('Llego tarde');
    expect(etiquetaDeResultado(undefined)).toBe('Sin marcar');
    expect(etiquetaDeEstadoDeClase('EN_CURSO')).toBe('En curso');
    expect(etiquetaDeEstadoDeClase('X')).toBe('Sin estado');
    expect(etiquetaDeEstadoDeInscripcion('LISTA_ESPERA')).toBe('En lista de espera');
    expect(etiquetaDeEstadoDeInscripcion(undefined)).toBe('Sin estado');
    expect(etiquetaDeEvento('CORRECCION')).toBe('Correccion');
    expect(etiquetaDeEvento(undefined)).toBe('Evento');
    expect(nombreDeParticipante(SIN_MARCAR)).toBe('Gomez, Ana');
    expect(nombreDeParticipante(EN_ESPERA)).toBe('Inscripción 3');
  });

  it('formatea en la zona de la sede y tolera vacios', () => {
    expect(horaEnZona('2026-10-14T13:00:00Z', 'America/Argentina/Cordoba')).toBe('10:00');
    expect(horaEnZona(undefined, 'UTC')).toBe('');
    expect(horaEnZona('basura', 'UTC')).toBe('');
    expect(horaEnZona('2026-10-14T13:00:00Z', 'Zona/Inexistente')).not.toBe('');
    expect(fechaHoraEnZona('2026-10-14T13:00:00Z', 'America/Argentina/Cordoba')).toContain('10:00');
    expect(fechaHoraEnZona('', 'UTC')).toBe('');
    expect(fechaHoraEnZona('basura', 'UTC')).toBe('');
    expect(fechaHoraEnZona('2026-10-14T13:00:00Z', 'Zona/Inexistente')).not.toBe('');
  });
});
