import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { BarraSuperior } from './barra-superior';
import { EstadoSesion, SessionService } from '../../core/services/session.service';
import { PlatformRoleStore } from '../../core/services/platform-role.store';
import { TIMEOUT_AXE, esperarSinViolaciones } from '../../core/testing/axe';
import { TenantContextStore } from '../../core/services/tenant-context.store';

/**
 * Barra superior.
 *
 * <p>Se prueba lo que decide que se ve: sin contexto, la unica salida; con contexto, el centro y
 * la sede (una sola vez si se llaman igual); y que el boton de menu dice si el panel esta abierto
 * y avisa al shell.
 */
describe('BarraSuperior', () => {
  let estado: WritableSignal<EstadoSesion>;
  let restaurando: WritableSignal<boolean>;
  let adminDePlataforma: WritableSignal<boolean>;
  let tenant: TenantContextStore;

  beforeEach(() => {
    estado = signal<EstadoSesion>('activa');
    restaurando = signal(false);
    adminDePlataforma = signal(false);

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: { estado, restaurando } },
        {
          provide: PlatformRoleStore,
          useValue: { esAdminDePlataforma: adminDePlataforma, asegurarCargado: () => undefined },
        },
      ],
    });
    tenant = TestBed.inject(TenantContextStore);
  });

  it('sin contexto ofrece elegir donde trabajar, y la consola solo a quien la administra', () => {
    estado.set('sin-contexto');
    const fixture = montar();
    const html = fixture.nativeElement as HTMLElement;

    expect(enlace(html, 'Elegí donde vas a trabajar')?.getAttribute('href')).toBe(
      '/seleccionar-contexto',
    );
    expect(enlace(html, 'Consola de plataforma')).toBeUndefined();
    expect(html.querySelector('button')).toBeNull();

    adminDePlataforma.set(true);
    fixture.detectChanges();
    expect(enlace(html, 'Consola de plataforma')?.getAttribute('href')).toBe(
      '/plataforma/solicitudes',
    );
  });

  it('con contexto muestra centro y sede, y el enlace para cambiarlo', () => {
    conContexto('Centro Kine', 'Sede Centro');
    const fixture = montar();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.contexto')?.textContent).toContain('Centro Kine');
    expect(html.querySelector('.contexto__sede')?.textContent).toContain('Sede Centro');
    expect(enlace(html, 'Cambiar')?.getAttribute('href')).toBe('/seleccionar-contexto');
    // La marca vive en la barra lateral cuando hay contexto.
    expect(html.querySelector('.marca')).toBeNull();
  });

  /** "Centro Norte · Centro Norte" no agrega informacion: la sede se dice solo si es distinta. */
  it('no repite la sede cuando se llama igual que el centro', () => {
    conContexto('Centro Norte', 'Centro Norte');
    const fixture = montar();

    expect((fixture.nativeElement as HTMLElement).querySelector('.contexto__sede')).toBeNull();
  });

  /** Con la restauracion en vuelo el contexto tiene un rotulo provisorio: la barra espera. */
  it('con la restauracion en vuelo muestra solo la marca', () => {
    restaurando.set(true);
    conContexto('Centro Kine', 'Sede Centro');
    const fixture = montar();
    const html = fixture.nativeElement as HTMLElement;

    expect(html.querySelector('.contexto')).toBeNull();
    expect(html.querySelector('.marca')).not.toBeNull();
  });

  it('el botón de menu refleja si el panel esta abierto y avisa al shell', () => {
    conContexto('Centro Kine', 'Sede Centro');
    const fixture = montar();
    const boton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[aria-controls="navegacion-principal"]',
    );
    expect(boton?.getAttribute('aria-expanded')).toBe('false');

    let pedidos = 0;
    fixture.componentInstance.alternarMenu.subscribe(() => pedidos++);
    boton?.click();
    expect(pedidos).toBe(1);

    fixture.componentRef.setInput('menuAbierto', true);
    fixture.detectChanges();
    expect(boton?.getAttribute('aria-expanded')).toBe('true');
  });

  it(
    'no tiene violaciones de accesibilidad',
    async () => {
      conContexto('Centro Kine', 'Sede Centro');
      const fixture = montar();

      await esperarSinViolaciones(fixture.nativeElement as HTMLElement);
    },
    TIMEOUT_AXE,
  );

  // --- Ayudantes ---------------------------------------------------------------------

  function montar(): ComponentFixture<BarraSuperior> {
    const fixture = TestBed.createComponent(BarraSuperior);
    fixture.detectChanges();
    return fixture;
  }

  function conContexto(organizationName: string, consultorioName: string): void {
    tenant.select({ organizationId: 1, organizationName, consultorioId: 2, consultorioName });
  }

  function enlace(html: HTMLElement, texto: string): HTMLAnchorElement | undefined {
    return Array.from(html.querySelectorAll<HTMLAnchorElement>('a')).find(
      (candidato) => candidato.textContent?.trim() === texto,
    );
  }
});
