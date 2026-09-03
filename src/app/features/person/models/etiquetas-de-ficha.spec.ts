import {
  AdjuntoResponseEstadoCicloDeVidaEnum as CicloDeVida,
  AdjuntoResponseEstadoEnum as Disponibilidad,
} from '../../../api/generated/model/adjunto-response';
import {
  adjuntoInactivo,
  adjuntoNoDisponible,
  esCategoria,
  etiquetaDeIndicador,
  fechaEnPalabras,
  hitoEnPalabras,
  importeEnPalabras,
  nombreDeAdjunto,
  nombreDeCategoria,
  nombreDeSeccion,
  omisionEnPalabras,
  tamanoEnPalabras,
  valorDeIndicador,
} from './etiquetas-de-ficha';

/**
 * Spec de las etiquetas de la ficha 360 y de los adjuntos (M07/M25, AKINE-03.02).
 *
 * <p>Lo que se prueba aca no es redaccion: son las tres decisiones que producen un dato
 * <b>equivocado</b> en pantalla si se hacen mal —una fecha corrida un dia, un campo ausente
 * escrito como "undefined", y una seccion nueva que desaparece—.
 */
describe('etiquetas de la ficha', () => {
  // -------------------------------------------------------------------------------------
  // Fechas: el bug del dia corrido
  // -------------------------------------------------------------------------------------

  it('una fecha sin hora NO se corre un dia', () => {
    // `new Date('2026-09-15')` es medianoche UTC, y en el huso de Argentina eso se formatea como
    // el 14. Una vigencia que empieza el 15 mostrada como el 14 es un dato equivocado en la
    // pantalla que decide si al paciente se lo puede atender.
    expect(fechaEnPalabras('2026-09-15')).toBe('15/09/2026');
    expect(fechaEnPalabras('2026-01-01')).toBe('01/01/2026');
  });

  it('un instante con hora si se formatea como fecha local', () => {
    expect(fechaEnPalabras('2026-09-15T18:00:00Z')).toContain('2026');
  });

  it('lo ausente y lo invalido devuelven vacio, no "undefined" ni "Invalid Date"', () => {
    expect(fechaEnPalabras(undefined)).toBe('');
    expect(fechaEnPalabras(null)).toBe('');
    expect(fechaEnPalabras('')).toBe('');
    expect(fechaEnPalabras('no es una fecha')).toBe('');
  });

  // -------------------------------------------------------------------------------------
  // Secciones e indicadores
  // -------------------------------------------------------------------------------------

  it('una seccion que este frontend no conoce se muestra con su clave, no se pierde', () => {
    // Las secciones las declaran los modulos que aportan y el contrato no las enumera. Si el
    // fallback fuera esconderlas, agregar un contribuyente del lado del backend produciria un
    // hueco invisible en la ficha.
    expect(nombreDeSeccion('turnos')).toBe('Turnos');
    expect(nombreDeSeccion('modulo-que-no-existe-todavia')).toBe('modulo-que-no-existe-todavia');
    expect(nombreDeSeccion(undefined)).toBe('Seccion');
  });

  it('la omision nombra el permiso que falta y dice que NO es que no haya datos', () => {
    const con = omisionEnPalabras({ seccion: 'economia', permisoRequerido: 'cobro:register' });
    expect(con).toContain('cobro:register');
    expect(con).toContain('No significa que no haya');

    // Sin el permiso declarado el aviso sigue siendo util: lo esencial es que la seccion no se
    // consulto.
    expect(omisionEnPalabras({ seccion: 'economia' })).toContain('no se consultaron');
  });

  it('un indicador de dinero se formatea con moneda y uno de cantidad no', () => {
    expect(valorDeIndicador({ clave: 'deuda', importe: 8500.5, moneda: 'ARS' })).toContain(
      '8.500,50',
    );
    expect(valorDeIndicador({ clave: 'turnos', cantidad: 0 })).toBe('0');
    // Un indicador sin ninguno de los dos no escribe "undefined" en la ficha de un paciente.
    expect(valorDeIndicador({ clave: 'raro' })).toBe('Sin dato');
  });

  it('un indicador sin etiqueta cae en su clave antes que en un texto generico', () => {
    expect(etiquetaDeIndicador({ clave: 'turnos-futuros' })).toBe('turnos-futuros');
    expect(etiquetaDeIndicador({})).toBe('Indicador');
  });

  it('un importe con moneda desconocida se muestra igual, sin simbolo', () => {
    // El importe importa mas que el simbolo: tirar el numero porque el navegador no reconoce el
    // codigo dejaria la ficha sin el dato.
    expect(importeEnPalabras(1234.5, 'NO_ES_UNA_MONEDA')).toContain('1.234,50');
    expect(importeEnPalabras(undefined, 'ARS')).toBe('');
  });

  it('un hito se lee con fecha, titulo y estado, y aguanta que falte cualquiera', () => {
    expect(hitoEnPalabras({ ocurrioEn: '2026-09-15', titulo: 'Turno', estado: 'CONFIRMADO' })).toBe(
      '15/09/2026 — Turno — CONFIRMADO',
    );
    expect(hitoEnPalabras({ tipo: 'TURNO' })).toBe('TURNO');
    expect(hitoEnPalabras({})).toBe('Hecho registrado');
  });

  // -------------------------------------------------------------------------------------
  // Adjuntos
  // -------------------------------------------------------------------------------------

  it('un adjunto sin titulo se muestra con el nombre del archivo, nunca vacio', () => {
    // Una fila sin nombre no se puede elegir.
    expect(nombreDeAdjunto({ titulo: 'Credencial', nombreArchivo: 'a.pdf' })).toBe('Credencial');
    expect(nombreDeAdjunto({ titulo: '   ', nombreArchivo: 'a.pdf' })).toBe('a.pdf');
    expect(nombreDeAdjunto({})).toBe('Documento sin nombre');
  });

  it('el ciclo de vida y la disponibilidad del contenido son dos cosas distintas', () => {
    // Un adjunto dado de baja se sigue descargando; uno cuyo binario se perdio, no. Confundirlos
    // deshabilitaria la descarga de todo lo dado de baja, que es justo lo que el historico
    // necesita.
    expect(adjuntoInactivo({ estadoCicloDeVida: CicloDeVida.INACTIVO })).toBe(true);
    expect(
      adjuntoInactivo({
        estadoCicloDeVida: CicloDeVida.ACTIVO,
        estado: Disponibilidad.NO_DISPONIBLE,
      }),
    ).toBe(false);
    expect(adjuntoNoDisponible({ estado: Disponibilidad.NO_DISPONIBLE })).toBe(true);
    expect(adjuntoNoDisponible({ estado: Disponibilidad.DISPONIBLE })).toBe(false);
  });

  it('el tamano se lee en la unidad que corresponde', () => {
    expect(tamanoEnPalabras(512)).toBe('512 B');
    expect(tamanoEnPalabras(2048)).toBe('2 kB');
    expect(tamanoEnPalabras(2_097_152)).toBe('2 MB');
    expect(tamanoEnPalabras(undefined)).toBe('');
    expect(tamanoEnPalabras(-1)).toBe('');
  });

  it('las categorias se traducen y las desconocidas se muestran crudas', () => {
    expect(nombreDeCategoria('CREDENCIAL_COBERTURA')).toBe('Credencial de cobertura');
    expect(nombreDeCategoria('CATEGORIA_NUEVA')).toBe('CATEGORIA_NUEVA');
    expect(nombreDeCategoria(undefined)).toBe('');
  });

  it('esCategoria valida lo que sale de un select y rechaza cualquier otra cosa', () => {
    // Lo que devuelve un `<select>` es un string cualquiera: sin esta guarda, el valor vacio de la
    // opcion "elegi una categoria" viajaria al backend.
    expect(esCategoria('CONSENTIMIENTO')).toBe(true);
    expect(esCategoria('')).toBe(false);
    expect(esCategoria('ESTUDIO')).toBe(false);
  });
});
