import { HttpRequest, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  TestRequest,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DocumentosDePersonaPage } from './documentos-de-persona-page';
import { PERMISO_PACIENTE_MANAGE } from '../../../../core/models/permisos';
import { PermissionsStore } from '../../../../core/services/permissions.store';
import { RUTA_PERMISOS_EFECTIVOS } from '../../../../core/testing/rutas-api';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../../../core/testing/axe';
import { TenantContextStore } from '../../../../core/services/tenant-context.store';
import { errorInterceptor } from '../../../../core/interceptors/error.interceptor';
import { provideApi } from '../../../../api/generated/provide-api';

const PERSONA = 7;
const FICHA = `/api/v1/personas/${PERSONA}`;
const ADJUNTOS = `/api/v1/personas/${PERSONA}/adjuntos`;

const ACTIVA = {
  id: PERSONA,
  apellido: 'Gomez',
  nombre: 'Ana',
  esPaciente: true,
  estado: 'ACTIVO',
  version: 1,
};

const CREDENCIAL = {
  id: 900,
  personaId: PERSONA,
  categoria: 'CREDENCIAL_COBERTURA',
  titulo: 'Credencial OSDE',
  nombreArchivo: 'credencial.pdf',
  contentType: 'application/pdf',
  tamanoBytes: 2_097_152,
  subidoEn: '2026-09-01T10:00:00Z',
  estado: 'DISPONIBLE',
  estadoCicloDeVida: 'ACTIVO',
  version: 0,
};

/**
 * Spec de la documentacion administrativa (M25, AKINE-03.02).
 *
 * <p>Cubre lo que decide comportamiento:
 *
 * <ol>
 *   <li><b>La subida viaja como multipart con la categoria en la query</b>, que es como lo declara
 *       el contrato, y sin archivo no sale nada.</li>
 *   <li><b>Los dos motivos de rechazo del archivo dan mensajes distintos.</b> "Elegi otro formato"
 *       y "elegi un archivo mas chico" son dos instrucciones distintas: con un mensaje generico el
 *       operador reintenta el mismo archivo.</li>
 *   <li><b>Un contenido no disponible se avisa ANTES de tocar descargar</b>, y el boton queda
 *       deshabilitado: el listado ya trae el dato.</li>
 *   <li><b>La baja exige motivo</b> y dice que el archivo no se borra.</li>
 *   <li><b>Una ficha dada de baja no ofrece subir</b>, y sigue listando lo que ya tiene.</li>
 * </ol>
 */
describe('DocumentosDePersonaPage', () => {
  let httpMock: HttpTestingController;
  let tenantContext: TenantContextStore;
  let permisos: PermissionsStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentosDePersonaPage],
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        provideApi(''),
      ],
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    tenantContext = TestBed.inject(TenantContextStore);
    permisos = TestBed.inject(PermissionsStore);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // -------------------------------------------------------------------------------------
  // 1. Listado
  // -------------------------------------------------------------------------------------

  it('muestra el titulo, la categoria en castellano y el tamano legible', async () => {
    const fixture = await montar([CREDENCIAL]);
    const contenido = texto(fixture);

    expect(contenido).toContain('Credencial OSDE');
    expect(contenido).toContain('Credencial de cobertura');
    // 2 MiB exactos. "2097152" no le dice nada a nadie parado en un mostrador.
    expect(contenido).toContain('2 MB');
  });

  it('avisa que aca no va nada clinico y que un adjunto no reemplaza un dato', async () => {
    const fixture = await montar([CREDENCIAL]);
    const contenido = texto(fixture);

    // Las dos confusiones mas caras del modulo, las dos arriba y no en letra chica.
    expect(contenido).toContain('Aca no va nada clinico');
    expect(contenido).toContain('no reemplaza un dato cargado');
  });

  it('el filtro de dados de baja manda incluirDadosDeBaja y el de vigentes lo omite', async () => {
    const fixture = await montar([CREDENCIAL]);

    elegirEn(fixture, '#documentos-filtro-estado', 'TODOS');
    const conBajas = httpMock.expectOne(esListado());
    expect(conBajas.request.urlWithParams).toContain('incluirDadosDeBaja=true');
    conBajas.flush(pagina([CREDENCIAL]));
    await estabilizar(fixture);

    elegirEn(fixture, '#documentos-filtro-estado', 'VIGENTES');
    const soloVigentes = httpMock.expectOne(esListado());
    // Omitido y no `false`: el backend ya tiene ese default, y mandarlo explicito diria lo mismo
    // con una URL distinta que despues cuesta reconocer en un log.
    expect(soloVigentes.request.urlWithParams).not.toContain('incluirDadosDeBaja');
    soloVigentes.flush(pagina([CREDENCIAL]));
    await estabilizar(fixture);
  });

  it('una lista vacia no es un error y dice que es normal', async () => {
    const fixture = await montar([]);

    expect(texto(fixture)).toContain('No hay documentos cargados');
    expect(texto(fixture)).toContain('cuando el paciente los trae');
  });

  // -------------------------------------------------------------------------------------
  // 2. Subida
  // -------------------------------------------------------------------------------------

  it('la subida viaja como multipart, con la categoria y el titulo en la query', async () => {
    const fixture = await montar([]);

    abrirSubidaCon(fixture, 'DOCUMENTO_IDENTIDAD', 'DNI frente');

    const pedido = httpMock.expectOne(esSubida());
    expect(pedido.request.body instanceof FormData).toBe(true);
    expect(pedido.request.urlWithParams).toContain('categoria=DOCUMENTO_IDENTIDAD');
    expect(pedido.request.urlWithParams).toContain('titulo=DNI');

    pedido.flush({
      ...CREDENCIAL,
      id: 901,
      categoria: 'DOCUMENTO_IDENTIDAD',
      titulo: 'DNI frente',
    });
    responderListado(httpMock.expectOne(esListado()), []);
    await estabilizar(fixture);

    // El exito repite la regla que produce el error mas caro del modulo.
    expect(texto(fixture)).toContain('no completa ningun dato de la ficha');
  });

  it('sin archivo elegido no manda nada', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Subir un documento');
    elegirEn(fixture, '#subida-categoria', 'OTRO');
    // Sin pasar por el input de archivo. El backend responderia 400 sobre un parametro, y el
    // operador leeria un error que no nombra el campo que le falta.
    apretar(fixture, 'Subir');

    httpMock.expectNone(esSubida());
  });

  it('sin categoria elegida no manda nada y marca el campo', async () => {
    const fixture = await montar([]);

    apretar(fixture, 'Subir un documento');
    adjuntarArchivo(fixture);
    apretar(fixture, 'Subir');

    httpMock.expectNone(esSubida());
    expect(texto(fixture)).toContain('Elegi la categoria del documento');
  });

  it('un archivo rechazado por TAMANO no dice que el formato este mal', async () => {
    const fixture = await montar([]);
    abrirSubidaCon(fixture, 'OTRO', '');

    httpMock.expectOne(esSubida()).flush(
      {
        type: 'https://akine.app/problems/archivo-no-aceptado',
        status: 400,
        detail: 'Archivo rechazado.',
        motivo: 'DEMASIADO_GRANDE',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('pesa mas de lo que se admite');
    // Decirle que cambie el formato lo manda a exportar el mismo escaneo a otro tipo y a fallar de
    // nuevo por el mismo motivo.
    expect(texto(fixture)).not.toContain('solo se aceptan PDF, PNG y JPEG');
  });

  it('un archivo rechazado por TIPO explica que el tipo se decide por el contenido', async () => {
    const fixture = await montar([]);
    abrirSubidaCon(fixture, 'OTRO', '');

    httpMock.expectOne(esSubida()).flush(
      {
        type: 'https://akine.app/problems/archivo-no-aceptado',
        status: 400,
        detail: 'Archivo rechazado.',
        motivo: 'TIPO_NO_PERMITIDO',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await estabilizar(fixture);

    // Sin esta frase, el reflejo es renombrar el archivo a .pdf y reintentar.
    expect(texto(fixture)).toContain('renombrarlo no cambia nada');
  });

  it('una ficha dada de baja no ofrece subir y lo explica, pero sigue listando', async () => {
    const fixture = await montar([CREDENCIAL], { ...ACTIVA, estado: 'INACTIVO' });

    expect(rotulosDeBoton(fixture)).not.toContain('Subir un documento');
    expect(texto(fixture)).toContain('no admite documentos nuevos');
    // Lo que ya tiene se sigue consultando: es RN-M07-004 aplicada al documento.
    expect(texto(fixture)).toContain('Credencial OSDE');
  });

  // -------------------------------------------------------------------------------------
  // 3. Contenido no disponible
  // -------------------------------------------------------------------------------------

  it('un contenido no disponible se avisa antes, y el boton de descargar queda deshabilitado', async () => {
    const fixture = await montar([{ ...CREDENCIAL, estado: 'NO_DISPONIBLE' }]);

    expect(texto(fixture)).toContain('Contenido no disponible');
    expect(botonDeshabilitado(fixture, 'Descargar')).toBe(true);
  });

  // -------------------------------------------------------------------------------------
  // 4. Reclasificar y dar de baja
  // -------------------------------------------------------------------------------------

  it('reclasificar manda un PATCH con la categoria nueva y dice que el archivo no se reemplaza', async () => {
    const fixture = await montar([CREDENCIAL]);

    apretar(fixture, 'Reclasificar');
    expect(texto(fixture)).toContain('El archivo, su nombre');
    elegirEn(fixture, `#reclasificar-categoria-${CREDENCIAL.id}`, 'OTRO');
    apretar(fixture, 'Guardar');

    const pedido = httpMock.expectOne(esReclasificar());
    expect(pedido.request.method).toBe('PATCH');
    expect((pedido.request.body as Record<string, unknown>)['categoria']).toBe('OTRO');

    pedido.flush({ ...CREDENCIAL, categoria: 'OTRO', version: 1 });
    responderListado(httpMock.expectOne(esListado()), [{ ...CREDENCIAL, categoria: 'OTRO' }]);
    await estabilizar(fixture);
  });

  it('con el motivo vacio no manda la baja del documento', async () => {
    const fixture = await montar([CREDENCIAL]);

    apretar(fixture, 'Dar de baja');
    apretar(fixture, 'Dar de baja el documento');

    httpMock.expectNone(esBaja());
  });

  it('la baja manda el motivo y aclara que el archivo no se borra', async () => {
    const fixture = await montar([CREDENCIAL]);

    apretar(fixture, 'Dar de baja');
    escribirEn(fixture, `#baja-adjunto-${CREDENCIAL.id}`, 'Se vencio la credencial.');
    apretar(fixture, 'Dar de baja el documento');

    const pedido = httpMock.expectOne(esBaja());
    expect((pedido.request.body as Record<string, unknown>)['motivo']).toBe(
      'Se vencio la credencial.',
    );

    pedido.flush({ ...CREDENCIAL, estadoCicloDeVida: 'INACTIVO' });
    responderListado(httpMock.expectOne(esListado()), []);
    await estabilizar(fixture);

    expect(texto(fixture)).toContain('El archivo no se borro');
  });

  it('un documento dado de baja se puede descargar y no se puede reclasificar', async () => {
    const fixture = await montar([
      { ...CREDENCIAL, estadoCicloDeVida: 'INACTIVO', deactivationReason: 'Vencida.' },
    ]);

    const rotulos = rotulosDeBoton(fixture);
    // La descarga sobrevive a la baja a proposito: una baja logica dice "esto ya no corresponde
    // para operar", no "esto nunca existio".
    expect(rotulos).toContain('Descargar');
    expect(rotulos).not.toContain('Reclasificar');
    expect(texto(fixture)).toContain('Vencida.');
  });

  // -------------------------------------------------------------------------------------
  // Accesibilidad
  // -------------------------------------------------------------------------------------

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      const fixture = await montar([CREDENCIAL]);
      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // -------------------------------------------------------------------------------------
  // Apoyo
  // -------------------------------------------------------------------------------------

  async function montar(
    adjuntos: object[],
    ficha: object = ACTIVA,
  ): Promise<ComponentFixture<DocumentosDePersonaPage>> {
    tenantContext.select({
      organizationId: 1,
      organizationName: 'Centro Belgrano',
      consultorioId: 3,
      consultorioName: 'Sede Centro',
    });

    permisos.cargar().subscribe();
    httpMock.expectOne(RUTA_PERMISOS_EFECTIVOS).flush({ permissions: [PERMISO_PACIENTE_MANAGE] });

    const fixture = TestBed.createComponent(DocumentosDePersonaPage);
    fixture.componentRef.setInput('personaId', String(PERSONA));
    fixture.detectChanges();

    httpMock.expectOne(FICHA).flush(ficha);
    responderListado(httpMock.expectOne(esListado()), adjuntos);
    await estabilizar(fixture);
    return fixture;
  }

  /** Abre el formulario, adjunta un archivo sintetico, elige categoria y envia. */
  function abrirSubidaCon(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    categoria: string,
    titulo: string,
  ): void {
    apretar(fixture, 'Subir un documento');
    adjuntarArchivo(fixture);
    elegirEn(fixture, '#subida-categoria', categoria);
    if (titulo !== '') {
      escribirEn(fixture, '#subida-titulo', titulo);
    }
    apretar(fixture, 'Subir');
  }

  /**
   * Adjunta un archivo al input de tipo `file`.
   *
   * <p>No se puede asignar `files` sobre el input real —es de solo lectura—, asi que se despacha el
   * `change` con un `target` armado a mano. Es lo mismo que hace el navegador: el componente lee
   * `files[0]` del target del evento, no del elemento.
   */
  function adjuntarArchivo(fixture: ComponentFixture<DocumentosDePersonaPage>): void {
    const archivo = new File(['contenido sintetico'], 'dni.pdf', { type: 'application/pdf' });
    const componente = fixture.componentInstance as unknown as {
      elegirArchivo(entrada: EventTarget | null): void;
    };
    componente.elegirArchivo({ files: [archivo] } as unknown as EventTarget);
    fixture.detectChanges();
  }

  async function estabilizar(fixture: ComponentFixture<DocumentosDePersonaPage>): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function pagina(contenido: object[]): object {
    return {
      content: contenido,
      page: 0,
      size: 20,
      totalElements: contenido.length,
      totalPages: 1,
    };
  }

  function responderListado(pedido: TestRequest, adjuntos: object[]): void {
    pedido.flush(pagina(adjuntos));
  }

  function esListado() {
    return (p: HttpRequest<unknown>) => p.method === 'GET' && p.url === ADJUNTOS;
  }

  function esSubida() {
    return (p: HttpRequest<unknown>) => p.method === 'POST' && p.url === ADJUNTOS;
  }

  function esReclasificar() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'PATCH' && p.url === `${ADJUNTOS}/${CREDENCIAL.id}`;
  }

  function esBaja() {
    return (p: HttpRequest<unknown>) =>
      p.method === 'DELETE' && p.url === `${ADJUNTOS}/${CREDENCIAL.id}`;
  }

  function elegirEn(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLSelectElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function escribirEn(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    selector: string,
    valor: string,
  ): void {
    const campo = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    campo.value = valor;
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function apretar(fixture: ComponentFixture<DocumentosDePersonaPage>, rotulo: string): void {
    const boton = botonDe(fixture, rotulo);
    if (boton === undefined) {
      throw new Error(`No hay ningun boton rotulado "${rotulo}".`);
    }
    boton.click();
    fixture.detectChanges();
  }

  function botonDeshabilitado(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    rotulo: string,
  ): boolean {
    return botonDe(fixture, rotulo)?.disabled === true;
  }

  function botonDe(
    fixture: ComponentFixture<DocumentosDePersonaPage>,
    rotulo: string,
  ): HTMLButtonElement | undefined {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => (b.textContent ?? '').trim() === rotulo);
  }

  function rotulosDeBoton(fixture: ComponentFixture<DocumentosDePersonaPage>): string[] {
    return Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).map((boton) => (boton.textContent ?? '').trim());
  }

  function texto(fixture: ComponentFixture<DocumentosDePersonaPage>): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }
});
