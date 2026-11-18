import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { NewConsultorioPage } from './new-consultorio-page';
import { AvisosStore } from '../../../../core/services/avisos.store';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const RUTA_ALTA = '/api/v1/organizations/1/consultorios';
const RUTA_ORGANIZACION = '/api/v1/organizations/1';
const RUTA_SEDE = '/api/v1/organizations/1/consultorios/3';

/** La sede que se edita en `sedes/3/editar`. */
const CENTRO = {
  id: 3,
  organizationId: 1,
  name: 'Sede Centro',
  timezone: 'America/Argentina/Cordoba',
  slotMinutes: 30,
  legalName: 'Kine Centro SRL',
  taxId: '30-71094127-7',
  phone: '351 400 0000',
  active: true,
  estado: 'ACTIVO',
  version: 4,
};

/** CUIT con digito verificador correcto segun el modulo 11 (y el mismo con el digito mal). */
const CUIT_VALIDO = '20-12345678-6';
const CUIT_INVALIDO = '20-12345678-5';

/**
 * Spec del alta de sede (M01, AKINE-02.01).
 *
 * <p>Se cubre lo que solo se rompe en produccion y en silencio:
 *
 * <ol>
 *   <li><b>La clave de idempotencia entre reintentos.</b> Si el reintento tras un corte de
 *       red va con una clave nueva, el backend crea una segunda sede: el bug produce datos
 *       duplicados y ningun error. Y si el usuario cambia el cuerpo y la clave se reusa, el
 *       backend responde `409` para siempre y el alta queda trabada.</li>
 *   <li><b>El tope del plan.</b> Es el error que mas se va a ver del modulo -el plan del alta
 *       self-service permite una sola sede- y tiene que leerse como un limite del plan
 *       contratado, con salida a la suscripcion, no como una falla tecnica.</li>
 * </ol>
 */
describe('NewConsultorioPage', () => {
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NewConsultorioPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    // El alta exitosa vuelve al listado de sedes, que esta prueba no registra.
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    TestBed.inject(TenantContextStore).select({
      organizationId: 1,
      organizationName: 'Belgrano',
      consultorioId: 3,
    });
  });

  afterEach(() => httpMock.verify());

  it('el reintento con el mismo cuerpo reusa la clave; cambiar el cuerpo genera una nueva', async () => {
    const fixture = montar();

    escribir(fixture, '#sede-name', 'Sede Norte');
    enviar(fixture, 3);

    // Paso 4: se envia y el request se pierde en el camino (status 0 = nunca llego).
    enviar(fixture);
    const primero = httpMock.expectOne(RUTA_ALTA);
    const clave = primero.request.headers.get('Idempotency-Key');
    expect(clave).toBeTruthy();
    primero.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('No se pudo contactar al servidor');

    // Reintento sin tocar nada: MISMA clave. Es lo unico que impide que un timeout de red
    // termine en dos sedes iguales, porque el cliente no sabe si el primero llego.
    enviar(fixture);
    const segundo = httpMock.expectOne(RUTA_ALTA);
    expect(segundo.request.headers.get('Idempotency-Key')).toBe(clave);
    segundo.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    // Ahora el usuario agrega un contacto: es otra alta, no un reintento. Reusar la clave
    // daria 409 idempotency-key-conflict y dejaria el formulario trabado para siempre.
    volverAlPaso(fixture, 'Datos de la sede');
    escribir(fixture, '#sede-contactEmail', 'sede.norte@ejemplo.test');
    enviar(fixture, 4);
    const tercero = httpMock.expectOne(RUTA_ALTA);
    expect(tercero.request.headers.get('Idempotency-Key')).not.toBe(clave);

    // El replay responde 201 con la MISMA sede: se muestra el exito una sola vez, sin
    // avisar de un duplicado que no existe.
    tercero.flush(
      { id: 9, name: 'Sede Norte', estado: 'ACTIVO' },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    // UX-12: un solo aviso de exito, y la pantalla vuelve al listado de sedes.
    const avisos = TestBed.inject(AvisosStore).avisos();
    expect(avisos.map((aviso) => aviso.titulo)).toEqual(['Sede creada']);
    expect(avisos[0]?.descripcion).toContain('Sede Norte');
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/organizacion/sedes');
  });

  /**
   * Escribir una duracion y despues borrarla NO es pedir turnos de cero minutos.
   *
   * <p>El `NumberValueAccessor` escribe `null` en el control cuando el `<input type="number">`
   * queda vacio, y la guarda vieja —`valores.slotMinutes !== ''`— lo dejaba pasar: `Number(null)`
   * es `0` y `Number.isFinite(0)` es verdadero, asi que el alta viajaba con `slotMinutes: 0`.
   * `Validators.min(1)` no lo frena porque un control vacio le resulta valido.
   */
  it('borrar la duración del turno la omite del alta en vez de mandarla en cero', async () => {
    const fixture = montar();

    escribir(fixture, '#sede-name', 'Sede Norte');
    escribir(fixture, '#sede-slotMinutes', '45');
    escribir(fixture, '#sede-slotMinutes', '');
    enviar(fixture, 4);

    const alta = httpMock.expectOne(RUTA_ALTA);
    expect(alta.request.body).toEqual({ name: 'Sede Norte' });

    alta.flush(
      { id: 9, name: 'Sede Norte', estado: 'ACTIVO' },
      { status: 201, statusText: 'Created' },
    );
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('el tope del plan se explica con el limite del plan y ofrece cambiarlo', async () => {
    const fixture = montar();

    escribir(fixture, '#sede-name', 'Sede Norte');
    enviar(fixture, 4);

    httpMock.expectOne(RUTA_ALTA).flush(
      {
        type: 'https://akine.app/problems/plan-limit-exceeded',
        detail: 'Limite MAX_CONSULTORIOS alcanzado',
        limitCode: 'MAX_CONSULTORIOS',
        limitValue: 1,
        currentUsage: 1,
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    // No se muestra el `detail` tecnico del backend: se dice que es el plan y cual es la
    // salida. Es el unico caso, junto con la ultima sede, donde el frontend redacta mejor.
    expect(texto(fixture)).toContain('Tu plan actual incluye una sola sede');
    expect(texto(fixture)).toContain('cambiar a un plan');
    expect(
      fixture.nativeElement.querySelector('a[href="/organizacion/suscripcion"]'),
    ).not.toBeNull();
  });

  describe('alta en un acto: primer box y horario general (A-8, CA-M03-002)', () => {
    it('el box y las franjas viajan en el mismo POST, con 24:00 como cierre', async () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      enviar(fixture, 2);
      escribir(fixture, '#sede-boxNombre', 'Box 1');
      escribir(fixture, '#sede-boxCapacidad', '2');
      // Abrir el lunes propone 09:00 a 18:00; el corte lo parte en 09-13 y 14-18.
      marcar(fixture, '#sede-horario-abre-1');
      pulsar(fixture, 'Corte al mediodía');
      escribir(fixture, '#sede-horario-hasta-1', '24:00');
      enviar(fixture);

      // La confirmacion dice lo que se va a crear, medianoche incluida.
      expect(texto(fixture)).toContain('Box 1 (capacidad 2)');
      expect(texto(fixture)).toContain('Lunes: 09:00 a 13:00 y 14:00 a medianoche (24:00)');

      enviar(fixture);
      const alta = httpMock.expectOne(RUTA_ALTA);
      expect(alta.request.body).toEqual({
        name: 'Sede Norte',
        primerBox: { name: 'Box 1', capacidad: 2 },
        horarioGeneral: [
          { diaSemana: 1, horaDesde: '09:00', horaHasta: '13:00' },
          { diaSemana: 1, horaDesde: '14:00', horaHasta: '24:00' },
        ],
      });
      alta.flush({ id: 9, name: 'Sede Norte' }, { status: 201, statusText: 'Created' });
      await fixture.whenStable();
      fixture.detectChanges();

      const [aviso] = TestBed.inject(AvisosStore).avisos();
      expect(aviso?.descripcion).toContain('Se creo junto con su primer box');
      expect(aviso?.descripcion).toContain('ningún turno se ofrece fuera de ese horario');
    });

    it('dos franjas del mismo día que se pisan no dejan avanzar', () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      enviar(fixture, 2);
      marcar(fixture, '#sede-horario-abre-1');
      pulsar(fixture, 'Corte al mediodía');
      escribir(fixture, '#sede-horario-desde-1', '12:00');
      enviar(fixture);

      expect(texto(fixture)).toContain('Paso 3 de 4');
      expect(texto(fixture)).toContain('Se pisa con otra franja del mismo día');
    });

    it('un 400 sobre una franja vuelve al paso 3 y marca esa franja, no un cartel generico', async () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      enviar(fixture, 2);
      marcar(fixture, '#sede-horario-abre-1');
      pulsar(fixture, 'Corte al mediodía');
      enviar(fixture, 2);

      httpMock.expectOne(RUTA_ALTA).flush(
        {
          type: 'https://akine.app/problems/validation-error',
          detail: 'La solicitud contiene campos invalidos',
          errors: { 'horarioGeneral[1].horaHasta': 'La hora de cierre tiene que ser HH:mm' },
        },
        { status: 400, statusText: 'Bad Request' },
      );
      await fixture.whenStable();
      fixture.detectChanges();

      expect(texto(fixture)).toContain('Paso 3 de 4');
      const error = fixture.nativeElement.querySelector('#sede-horario-error-1');
      expect(error?.textContent).toContain('La hora de cierre tiene que ser HH:mm');
      expect(fixture.nativeElement.querySelector('#sede-horario-error-0')).toBeNull();
      // El cartel no repite lo que ya se marca junto a la franja.
      expect(texto(fixture)).toContain('Revisá los campos marcados.');
      expect(texto(fixture).split('La hora de cierre tiene que ser HH:mm')).toHaveLength(2);
    });
  });

  describe('ubicación, visibilidad y datos fiscales (M03, 05/11/2026)', () => {
    it('la dirección en partes, el punto escrito a mano y la agenda apagada viajan en el alta', async () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      escribir(fixture, '#sede-alias', 'Norte');
      escribir(fixture, '#sede-phone', '+54 11 4321-9876');
      marcar(fixture, '#sede-agendaHabilitada');
      enviar(fixture);
      escribir(fixture, '#sede-ubicacion-calle', 'Av. Cabildo');
      escribir(fixture, '#sede-ubicacion-numero', '1234');
      escribir(fixture, '#sede-ubicacion-ciudad', 'CABA');
      escribir(fixture, '#sede-ubicacion-codigoPostal', 'C1426');
      escribir(fixture, '#sede-ubicacion-latitud', '-34.5593');
      escribir(fixture, '#sede-ubicacion-longitud', '-58.4526');
      enviar(fixture, 2);

      // La confirmacion dice donde esta y que todavia no recibe turnos.
      expect(texto(fixture)).toContain('Av. Cabildo 1234, CABA, C1426');
      expect(texto(fixture)).toContain('ajustada a mano');
      expect(texto(fixture)).toContain('Sin agenda por ahora');

      enviar(fixture);
      const alta = httpMock.expectOne(RUTA_ALTA);
      expect(alta.request.body).toEqual({
        name: 'Sede Norte',
        alias: 'Norte',
        phone: '+54 11 4321-9876',
        pais: 'AR',
        ciudad: 'CABA',
        calle: 'Av. Cabildo',
        numero: '1234',
        codigoPostal: 'C1426',
        ubicacion: { latitud: -34.5593, longitud: -58.4526, origen: 'MANUAL' },
        agendaHabilitada: false,
      });
      alta.flush({ id: 9, name: 'Sede Norte' }, { status: 201, statusText: 'Created' });
      await fixture.whenStable();
      fixture.detectChanges();

      const [aviso] = TestBed.inject(AvisosStore).avisos();
      expect(aviso?.descripcion).toContain('Todavía no recibe turnos');
    });

    it('una dirección sin punto se guarda igual y queda pendiente de verificar', () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      enviar(fixture);
      escribir(fixture, '#sede-ubicacion-calle', 'Av. Cabildo');
      escribir(fixture, '#sede-ubicacion-ciudad', 'CABA');
      enviar(fixture, 2);

      expect(texto(fixture)).toContain('Ubicación pendiente de verificar');

      enviar(fixture);
      const alta = httpMock.expectOne(RUTA_ALTA);
      expect(alta.request.body).toEqual({
        name: 'Sede Norte',
        pais: 'AR',
        ciudad: 'CABA',
        calle: 'Av. Cabildo',
      });
      expect(alta.request.body).not.toHaveProperty('ubicacion');
      alta.flush({ id: 9, name: 'Sede Norte' }, { status: 201, statusText: 'Created' });
    });

    it('una latitud sin longitud no deja avanzar del paso 2', () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      enviar(fixture);
      escribir(fixture, '#sede-ubicacion-latitud', '-34.5');
      enviar(fixture);

      expect(texto(fixture)).toContain('Paso 2 de 4');
      expect(texto(fixture)).toContain('Latitud y longitud van juntas');
    });

    it('los datos fiscales propios exigen un CUIT que cierre, y por defecto se heredan', () => {
      const fixture = montar();

      escribir(fixture, '#sede-name', 'Sede Norte');
      enviar(fixture, 2);

      // Heredados: el paso 3 muestra los de la organizacion sin pedir nada.
      expect(texto(fixture)).toContain('CUIT: 30-71094127-7');

      marcar(fixture, '#sede-datosFiscalesPropios');
      escribir(fixture, '#sede-legalName', 'Sede Norte SRL');
      escribir(fixture, '#sede-taxId', CUIT_INVALIDO);
      enviar(fixture);

      expect(texto(fixture)).toContain('Paso 3 de 4');
      expect(texto(fixture)).toContain('El CUIT no es válido');

      escribir(fixture, '#sede-taxId', CUIT_VALIDO);
      enviar(fixture);
      expect(texto(fixture)).toContain('Propios de la sede');

      enviar(fixture);
      const alta = httpMock.expectOne(RUTA_ALTA);
      expect(alta.request.body).toEqual({
        name: 'Sede Norte',
        datosFiscalesPropios: true,
        legalName: 'Sede Norte SRL',
        taxId: CUIT_VALIDO,
      });
      alta.flush({ id: 9, name: 'Sede Norte' }, { status: 201, statusText: 'Created' });
    });
  });

  // -----------------------------------------------------------------------------------------
  // Edicion (13/11/2026): "Editar" del listado de sedes abre esta misma pantalla de pasos.
  // -----------------------------------------------------------------------------------------

  it('editar: el PATCH manda solo lo que cambio, lo vaciado como cadena vacía y lo intacto ni aparece', async () => {
    const fixture = await montarEdicion();

    // Se cambia el nombre, se BORRA el telefono vaciandolo y no se toca la razon social.
    escribir(fixture, '#sede-name', 'Sede Centro Nueva');
    escribir(fixture, '#sede-phone', '');
    enviar(fixture, 4);

    const peticion = httpMock.expectOne(
      (candidata) => candidata.method === 'PATCH' && candidata.url === RUTA_SEDE,
    );
    const cuerpo = peticion.request.body as Record<string, unknown>;
    expect(cuerpo).toEqual({ version: 4, name: 'Sede Centro Nueva', phone: '' });
    // La razon social ni siquiera viaja: mandarla -aunque fuera su valor actual- la pisaria
    // en cada guardado, y con ella cualquier correccion que otra persona hubiera hecho.
    expect('legalName' in cuerpo).toBe(false);
    expect('timezone' in cuerpo).toBe(false);

    peticion.flush({ ...CENTRO, name: 'Sede Centro Nueva', version: 5 });
    await fixture.whenStable();
    fixture.detectChanges();

    const [aviso] = TestBed.inject(AvisosStore).avisos();
    expect(aviso?.titulo).toBe('Cambios guardados');
    expect(aviso?.descripcion).toBe('Sede Centro Nueva');
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/organizacion/sedes');
  });

  /**
   * Vaciar un campo de texto es "borralo"; vaciar uno numerico NO es "ponelo en cero": un
   * `<input type="number">` vaciado entrega `null`, y `Number(null)` mandaria `slotMinutes: 0`.
   */
  it('editar: vaciar la duración del turno no manda un cero, el campo directamente no viaja', async () => {
    const fixture = await montarEdicion();

    escribir(fixture, '#sede-name', 'Sede Centro Nueva');
    escribir(fixture, '#sede-slotMinutes', '');
    enviar(fixture, 4);

    const peticion = httpMock.expectOne((candidata) => candidata.method === 'PATCH');
    const cuerpo = peticion.request.body as Record<string, unknown>;
    expect(cuerpo).toEqual({ version: 4, name: 'Sede Centro Nueva' });
    expect('slotMinutes' in cuerpo).toBe(false);

    peticion.flush({ ...CENTRO, name: 'Sede Centro Nueva', version: 5 });
    await fixture.whenStable();
  });

  it('editar: una versión vieja no pisa nada, relee la sede, avisa y conserva lo escrito', async () => {
    const fixture = await montarEdicion();

    escribir(fixture, '#sede-name', 'Sede Centro Nueva');
    enviar(fixture, 4);
    responderConflicto();
    await fixture.whenStable();
    fixture.detectChanges();

    // Se relee la sede para tomar la version nueva como base: reintentar en silencio con ella
    // seria justamente pisar el cambio del otro, que es lo que el 409 evita.
    httpMock.expectOne(RUTA_SEDE).flush({ ...CENTRO, name: 'Sede Centro Sur', version: 9 });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Alguien mas edito esta sede');
    expect(TestBed.inject(Router).navigateByUrl).not.toHaveBeenCalled();

    // Si el usuario insiste, el reintento lleva lo que escribio y la version releida.
    enviar(fixture);
    const reintento = httpMock.expectOne((candidata) => candidata.method === 'PATCH');
    const cuerpo = reintento.request.body as Record<string, unknown>;
    expect(cuerpo['version']).toBe(9);
    expect(cuerpo['name']).toBe('Sede Centro Nueva');
    reintento.flush({ ...CENTRO, name: 'Sede Centro Nueva', version: 10 });
    await fixture.whenStable();
  });

  it('editar: si la relectura posterior al 409 también falla, el mensaje queda y no se sale', async () => {
    const fixture = await montarEdicion();

    escribir(fixture, '#sede-name', 'Sede Centro Nueva');
    enviar(fixture, 4);
    responderConflicto();
    await fixture.whenStable();
    fixture.detectChanges();

    httpMock
      .expectOne(RUTA_SEDE)
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Alguien mas edito esta sede');
    expect(TestBed.inject(Router).navigateByUrl).not.toHaveBeenCalled();
  });

  it('editar: un email mal formado o un nombre vacío no salen al backend', async () => {
    const fixture = await montarEdicion();

    // El envio tiene que quedar BLOQUEADO: si saliera, el backend responderia 400 y el usuario
    // veria un error generico en vez del campo marcado.
    escribir(fixture, '#sede-contactEmail', 'esto-no-es-un-mail');
    enviar(fixture, 4);
    httpMock.expectNone((peticion) => peticion.method === 'PATCH');
    expect(texto(fixture)).toContain('Ese email no tiene una forma válida');

    // Un nombre de solo espacios es un nombre vacio: viajaria como un renombre a cadena vacia.
    escribir(fixture, '#sede-contactEmail', '');
    escribir(fixture, '#sede-name', '   ');
    enviar(fixture, 4);
    httpMock.expectNone((peticion) => peticion.method === 'PATCH');
    expect(texto(fixture)).toContain('La sede necesita un nombre');
  });

  function responderConflicto() {
    httpMock
      .expectOne((candidata) => candidata.method === 'PATCH')
      .flush(
        {
          type: 'https://akine.app/problems/concurrent-modification',
          detail: 'La versión enviada quedo vieja',
        },
        { status: 409, statusText: 'Conflict' },
      );
  }

  /** Monta la pantalla en modo edicion de la sede 3, con la sede ya leida. */
  async function montarEdicion() {
    const fixture = TestBed.createComponent(NewConsultorioPage);
    fixture.componentRef.setInput('sedeId', '3');
    fixture.detectChanges();
    httpMock
      .expectOne(RUTA_ORGANIZACION)
      .flush({ id: 1, name: 'Belgrano', version: 1, taxId: '30-71094127-7' });
    httpMock.expectOne(RUTA_SEDE).flush(CENTRO);
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /** Monta la pantalla y responde la lectura de la organizacion que hace al arrancar. */
  function montar() {
    const fixture = TestBed.createComponent(NewConsultorioPage);
    fixture.detectChanges();
    httpMock
      .expectOne(RUTA_ORGANIZACION)
      .flush({ id: 1, name: 'Belgrano', version: 1, taxId: '30-71094127-7' });
    fixture.detectChanges();
    return fixture;
  }
});

function texto(fixture: { nativeElement: HTMLElement }): string {
  return fixture.nativeElement.textContent ?? '';
}

function escribir(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  selector: string,
  valor: string,
) {
  const campo = fixture.nativeElement.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.value = valor;
  // Las horas del horario son desplegables: el formulario escucha `change`, no `input`.
  campo.dispatchEvent(new Event(campo instanceof HTMLSelectElement ? 'change' : 'input'));
  fixture.detectChanges();
}

function marcar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, selector: string) {
  const campo = fixture.nativeElement.querySelector<HTMLInputElement>(selector);
  if (campo === null) {
    throw new Error(`No existe el campo ${selector}`);
  }
  campo.click();
  fixture.detectChanges();
}

function pulsar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, rotulo: string) {
  const boton = Array.from(
    fixture.nativeElement.querySelectorAll<HTMLButtonElement>('button'),
  ).find((candidato) => candidato.textContent?.includes(rotulo));
  if (boton === undefined) {
    throw new Error(`No existe el botón ${rotulo}`);
  }
  boton.click();
  fixture.detectChanges();
}

/** El unico `form` de la pantalla avanza de paso o envia, segun en cual este. */
function enviar(fixture: { nativeElement: HTMLElement; detectChanges(): void }, veces = 1) {
  for (let i = 0; i < veces; i++) {
    const formulario = fixture.nativeElement.querySelector<HTMLFormElement>('form');
    formulario?.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }
}

/** Vuelve a un paso ya hecho desde el indicador de pasos, como lo haria el usuario. */
function volverAlPaso(
  fixture: { nativeElement: HTMLElement; detectChanges(): void },
  titulo: string,
) {
  const boton = Array.from(
    fixture.nativeElement.querySelectorAll<HTMLButtonElement>('.asistente__volver'),
  ).find((candidato) => candidato.textContent?.includes(titulo));
  if (boton === undefined) {
    throw new Error(`No hay un paso hecho llamado ${titulo}`);
  }
  boton.click();
  fixture.detectChanges();
}
