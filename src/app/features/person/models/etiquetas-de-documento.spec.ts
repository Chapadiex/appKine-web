import { AutorizacionResponseEstadoEnum as CicloAut } from '../../../api/generated/model/autorizacion-response';
import { OrdenResponseEstadoEnum as CicloOrden } from '../../../api/generated/model/orden-response';
import { AutorizacionResponseEstadoAutorizacionEnum as EstadoAut } from '../../../api/generated/model/autorizacion-response';
import { ElegibilidadResponseMotivoEnum as MotivoElegibilidad } from '../../../api/generated/model/elegibilidad-response';
import { RequisitoResponseTipoEnum as TipoRequisito } from '../../../api/generated/model/requisito-response';
import {
  admiteResolucion,
  autorizacionInactiva,
  avisoDeVencimiento,
  emisorEnPalabras,
  estadoDeAutorizacion,
  habilitaEnPalabras,
  motivoDeElegibilidad,
  nombreDeRequisito,
  ordenInactiva,
  requisitoEnPalabras,
  saldoEnPalabras,
  situacionDeOrden,
  vigenciaDeDocumento,
} from './etiquetas-de-documento';
import {
  coberturaEnUnaLinea,
  coberturaInactiva,
  coberturaOperable,
  credencialEnPalabras,
  situacionEnPalabras,
  vigenciaEnPalabras,
} from './etiquetas-de-cobertura';

/**
 * Spec de las etiquetas de coberturas, ordenes y autorizaciones (M08/M17, 03.04 y 03.06).
 *
 * <p><b>Casi todo lo que se prueba aca es una distincion, no una redaccion.</b> Vencido, agotado,
 * rechazado y dado de baja son cuatro cosas distintas; finalizar una vigencia y dar de baja una
 * cobertura, otras dos. Si alguna se pierde, la pantalla sigue funcionando y el operador toma la
 * decision equivocada — que es exactamente el defecto que ningun test de pantalla encuentra.
 */
describe('etiquetas de coberturas', () => {
  it('PARTICULAR se escribe "Particular" y no como un dato faltante', () => {
    // Es la ausencia de plan financiado, que es una modalidad completa (RN-M08-001). Un guion
    // invitaria a "completarla" cargando un plan que no existe.
    expect(coberturaEnUnaLinea({ tipo: 'PARTICULAR' })).toBe('Particular');
    expect(
      coberturaEnUnaLinea({ tipo: 'FINANCIADA', financiadorNombre: 'OSDE', planNombre: '210' }),
    ).toBe('OSDE — 210');
    // El texto sale de la copia congelada, y si el plan no viajo se muestra el financiador solo.
    expect(coberturaEnUnaLinea({ tipo: 'FINANCIADA', financiadorNombre: 'OSDE' })).toBe('OSDE');
    expect(coberturaEnUnaLinea({ tipo: 'FINANCIADA' })).toBe('Financiador sin nombre');
  });

  it('una cobertura sin fecha de fin lo dice, en vez de dejar un hueco', () => {
    // Una cobertura abierta es el caso normal —el paciente sigue afiliado—, y un hueco invita a
    // poner una fecha inventada que despues cierra una cobertura que estaba bien.
    expect(vigenciaEnPalabras({ vigenciaDesde: '2026-01-01' })).toBe(
      'Desde el 01/01/2026, sin fecha de fin',
    );
    expect(vigenciaEnPalabras({ vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-06-30' })).toBe(
      '01/01/2026 — 30/06/2026',
    );
    expect(vigenciaEnPalabras({ vigenciaHasta: '2026-06-30' })).toBe('Hasta el 30/06/2026');
    expect(vigenciaEnPalabras({})).toBe('Sin vigencia declarada');
  });

  it('dada de baja, vigencia terminada y vigente son tres situaciones distintas', () => {
    // Fundirlas hace que alguien de de baja una cobertura correcta de un paciente que cambio de
    // obra social, en vez de finalizarle la vigencia.
    expect(situacionEnPalabras({ estado: 'INACTIVA' })).toBe('Dada de baja');
    expect(situacionEnPalabras({ estado: 'ACTIVA', vigente: false })).toBe('Vigencia terminada');
    expect(situacionEnPalabras({ estado: 'ACTIVA', vigente: true })).toBe('Vigente');
  });

  it('una credencial vencida se informa y no invalida la cobertura', () => {
    expect(
      credencialEnPalabras({ credencialVigenciaHasta: '2026-01-01', credencialVencida: true }),
    ).toBe('Vencida el 01/01/2026');
    expect(
      credencialEnPalabras({ credencialVigenciaHasta: '2027-01-01', credencialVencida: false }),
    ).toBe('Vigente hasta el 01/01/2027');
    // Sin vencimiento cargado se distingue segun el plan lo exigiera o no: lo primero es un dato
    // que falta, lo segundo no.
    expect(credencialEnPalabras({ requeriaCredencial: true })).toContain('el plan la exigia');
    expect(credencialEnPalabras({})).toBe('Sin vencimiento cargado');
  });

  it('una cobertura dada de baja no es operable: las tres acciones responden 409', () => {
    expect(coberturaInactiva({ estado: 'INACTIVA' })).toBe(true);
    expect(coberturaOperable({ estado: 'INACTIVA' })).toBe(false);
    expect(coberturaOperable({ estado: 'ACTIVA' })).toBe(true);
  });
});

describe('etiquetas de ordenes y autorizaciones', () => {
  it('vencida y dada de baja son dos situaciones distintas de una orden', () => {
    // "Un documento vencido no desaparece": una orden vencida sigue activa y se puede corregir.
    expect(situacionDeOrden({ estado: CicloOrden.INACTIVA })).toBe('Dada de baja');
    expect(situacionDeOrden({ estado: CicloOrden.ACTIVA, vencida: true })).toBe('Vencida');
    expect(situacionDeOrden({ estado: CicloOrden.ACTIVA, vigente: true })).toBe('Vigente');
    // Una orden cargada con vigencia futura no esta vencida ni vigente todavia.
    expect(situacionDeOrden({ estado: CicloOrden.ACTIVA, vigente: false })).toBe(
      'Todavia no vigente',
    );
    expect(ordenInactiva({ estado: CicloOrden.INACTIVA })).toBe(true);
  });

  it('el aviso de vencimiento solo aparece cuando hay algo que avisar', () => {
    expect(avisoDeVencimiento(0)).toBe('Vence hoy');
    expect(avisoDeVencimiento(1)).toBe('Vence manana');
    expect(avisoDeVencimiento(5)).toBe('Vence en 5 dias');
    // Vacio significa "no dibujes nada": un "sin alerta" seria ruido en una tabla que se escanea
    // con la vista.
    expect(avisoDeVencimiento(90)).toBe('');
    expect(avisoDeVencimiento(-3)).toBe('');
    expect(avisoDeVencimiento(undefined)).toBe('');
  });

  it('el emisor se muestra con matricula solo si la hay: el papel puede ser ilegible', () => {
    expect(emisorEnPalabras({ profesionalEmisor: 'Dra. Perez', matriculaEmisor: '123' })).toBe(
      'Dra. Perez (MP 123)',
    );
    expect(emisorEnPalabras({ profesionalEmisor: 'Dra. Perez' })).toBe('Dra. Perez');
    expect(emisorEnPalabras({})).toBe('Emisor sin nombre');
  });

  it('la vigencia de un documento sin vencimiento lo dice', () => {
    expect(vigenciaDeDocumento('2026-08-01', '2026-12-31')).toBe('01/08/2026 — 31/12/2026');
    expect(vigenciaDeDocumento('2026-08-01', undefined)).toBe(
      'Desde el 01/08/2026, sin vencimiento',
    );
    expect(vigenciaDeDocumento(undefined, '2026-12-31')).toBe('Hasta el 31/12/2026');
    expect(vigenciaDeDocumento(undefined, undefined)).toBe('Sin vigencia declarada');
  });

  it('los cuatro estados de una autorizacion se traducen, y lo desconocido se muestra crudo', () => {
    expect(estadoDeAutorizacion({ estadoAutorizacion: EstadoAut.PENDIENTE })).toBe(
      'Pendiente de respuesta',
    );
    expect(estadoDeAutorizacion({ estadoAutorizacion: EstadoAut.RECHAZADA })).toBe('Rechazada');
    expect(estadoDeAutorizacion({})).toBe('Sin estado');
  });

  it('solo PENDIENTE y OBSERVADA admiten respuesta: las otras dos son terminales', () => {
    // Ofrecer las acciones sobre una terminal seria ofrecer un 409, y sugeriria que una decision
    // tomada se puede deshacer — que es lo que haria desaparecer retroactivamente un saldo ya
    // contado para atender a alguien.
    expect(
      admiteResolucion({ estado: CicloAut.ACTIVA, estadoAutorizacion: EstadoAut.PENDIENTE }),
    ).toBe(true);
    expect(
      admiteResolucion({ estado: CicloAut.ACTIVA, estadoAutorizacion: EstadoAut.OBSERVADA }),
    ).toBe(true);
    expect(
      admiteResolucion({ estado: CicloAut.ACTIVA, estadoAutorizacion: EstadoAut.APROBADA }),
    ).toBe(false);
    expect(
      admiteResolucion({ estado: CicloAut.ACTIVA, estadoAutorizacion: EstadoAut.RECHAZADA }),
    ).toBe(false);
    // Una dada de baja no admite nada, cualquiera sea su estado de autorizacion.
    expect(
      admiteResolucion({ estado: CicloAut.INACTIVA, estadoAutorizacion: EstadoAut.PENDIENTE }),
    ).toBe(false);
    expect(autorizacionInactiva({ estado: CicloAut.INACTIVA })).toBe(true);
  });

  it('el saldo se lee como "restantes de autorizadas"', () => {
    expect(saldoEnPalabras({ cantidadAutorizada: 20, cantidadConsumida: 0, saldo: 20 })).toBe(
      '20 de 20',
    );
    // Sin `saldo` explicito se calcula, y sin cantidad declarada no se inventa un numero.
    expect(saldoEnPalabras({ cantidadAutorizada: 10, cantidadConsumida: 4 })).toBe('6 de 10');
    expect(saldoEnPalabras({})).toBe('Sin cantidad declarada');
  });

  it('el veredicto dice POR QUE no habilita, y no un "no" a secas', () => {
    // "Si" y "no" sin motivo obligan a quien mira a reconstruir cual de las cuatro condiciones
    // falla, con la autorizacion en la mano.
    expect(habilitaEnPalabras({ habilita: true })).toBe('Habilita a atender');
    expect(habilitaEnPalabras({ estado: CicloAut.INACTIVA })).toContain('esta dada de baja');
    expect(
      habilitaEnPalabras({ estado: CicloAut.ACTIVA, estadoAutorizacion: EstadoAut.PENDIENTE }),
    ).toContain('pendiente de respuesta');
    expect(
      habilitaEnPalabras({
        estado: CicloAut.ACTIVA,
        estadoAutorizacion: EstadoAut.APROBADA,
        vencida: true,
      }),
    ).toContain('vencida');
    expect(
      habilitaEnPalabras({
        estado: CicloAut.ACTIVA,
        estadoAutorizacion: EstadoAut.APROBADA,
        agotada: true,
      }),
    ).toContain('no le queda saldo');
    // Aprobada, vigente y con saldo pero `habilita` en false: el backend manda y no se contradice.
    expect(
      habilitaEnPalabras({ estado: CicloAut.ACTIVA, estadoAutorizacion: EstadoAut.APROBADA }),
    ).toBe('No habilita');
  });

  it('las tres situaciones de "no falta nada" se explican, y la cuarta no dice nada', () => {
    // Sin explicacion, "todo en orden" sobre un paciente sin convenio se lee como que el sistema
    // no verifico nada.
    expect(motivoDeElegibilidad({ motivo: MotivoElegibilidad.COBERTURA_PARTICULAR })).toContain(
      'particular',
    );
    expect(motivoDeElegibilidad({ motivo: MotivoElegibilidad.SIN_CONVENIO_VIGENTE })).toContain(
      'convenio vigente con ese plan',
    );
    expect(motivoDeElegibilidad({ motivo: MotivoElegibilidad.SIN_ARANCEL_VIGENTE })).toContain(
      'hueco de configuracion',
    );
    // Sin motivo, el convenio simplemente no exige nada: no hay nada que aclarar.
    expect(motivoDeElegibilidad({})).toBe('');
  });

  it('un requisito se lee con su tipo, si esta cumplido y con que', () => {
    expect(nombreDeRequisito({ tipo: TipoRequisito.ORDEN })).toBe('Orden medica');
    expect(nombreDeRequisito({})).toBe('Requisito');
    expect(
      requisitoEnPalabras({
        tipo: TipoRequisito.AUTORIZACION,
        cumplido: false,
        detalle: 'No hay ninguna.',
      }),
    ).toBe('Autorizacion: FALTA — No hay ninguna.');
    expect(requisitoEnPalabras({ tipo: TipoRequisito.CREDENCIAL, cumplido: true })).toBe(
      'Credencial vigente: cumplido',
    );
  });
});
