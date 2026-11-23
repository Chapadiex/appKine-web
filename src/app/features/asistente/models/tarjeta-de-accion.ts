import { ConfirmarAccion } from '../../../api/generated/model/confirmar-accion';
import { ImputacionEnTarjeta } from '../../../api/generated/model/imputacion-en-tarjeta';

/** Un importe sin el ruido de la coma flotante: 100,10 + 200,20 no es 300,30000000000007. */
export function aCentavos(importe: number): number {
  return Math.round(importe * 100) / 100;
}

export function sumaDeImputaciones(
  imputaciones: readonly ImputacionEnTarjeta[] | undefined,
): number {
  return aCentavos((imputaciones ?? []).reduce((suma, i) => suma + (i.importe ?? 0), 0));
}

/**
 * Lo que le falta a la tarjeta para poder confirmarse, en palabras, o `null` si está completa. Es
 * ayuda de pantalla: el servidor revalida todo al confirmar.
 */
export function motivoQueImpideConfirmar(tipo: string, borrador: ConfirmarAccion): string | null {
  switch (tipo) {
    case 'ASISTENCIA_CLASE': {
      const a = borrador.asistencia;
      const clase = a?.clases?.find((c) => c.claseId === a.claseId);
      if (!clase) {
        return 'Elegí la clase.';
      }
      return clase.items?.some((i) => i.resultado) ? null : 'Marcá al menos a una persona.';
    }
    case 'PAGO': {
      const p = borrador.pago;
      if (!p?.total || p.total <= 0) {
        return 'Falta el monto.';
      }
      if (!p.medio) {
        return 'Elegí el medio de pago.';
      }
      if (p.medio === 'EFECTIVO' && !p.cajaAbierta) {
        return 'La caja de la sede está cerrada: abrila para cobrar en efectivo.';
      }
      const imputado = sumaDeImputaciones(p.imputaciones);
      if (
        (p.imputaciones ?? []).some(
          (i) => (i.importe ?? 0) < 0 || (i.importe ?? 0) > (i.saldo ?? 0),
        )
      ) {
        return 'Lo aplicado a una deuda no puede superar su saldo.';
      }
      return imputado > p.total ? 'Lo aplicado a las deudas supera el monto.' : null;
    }
    case 'ATENCION': {
      const a = borrador.atencion;
      if (!a?.turnoId && (a?.turnos?.length ?? 0) > 0) {
        return 'Elegí el turno.';
      }
      if (!a?.turnoId && !a?.ofertaId) {
        return 'Elegí el servicio.';
      }
      if (!a?.casoId && (a?.casos?.length ?? 0) > 1) {
        return 'Elegí el caso clínico.';
      }
      if (a?.cerrar && (a.tratamientos ?? []).some((t) => !t.practicaId)) {
        return 'Quitá los tratamientos no reconocidos o dejá la atención abierta.';
      }
      return a?.cerrar && !a.nota?.trim() ? 'Falta la nota de cierre.' : null;
    }
    case 'PACIENTE_ALTA': {
      const p = borrador.paciente;
      if (!p?.datos?.nombre || !p.datos.apellido) {
        return 'Falta el nombre y el apellido.';
      }
      return (p.posiblesDuplicados?.length ?? 0) > 0 && !p.confirmaPosibleDuplicado
        ? 'Confirmá que es otra persona.'
        : null;
    }
    case 'PACIENTE_EDICION': {
      const d = borrador.paciente?.datos;
      return d?.telefono || d?.email || d?.documento || d?.fechaNacimiento
        ? null
        : 'No hay ningún dato para cambiar.';
    }
    default:
      return null;
  }
}
