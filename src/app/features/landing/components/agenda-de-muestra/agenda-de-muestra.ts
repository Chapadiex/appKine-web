import { ChangeDetectionStrategy, Component } from '@angular/core';

import { Icono, NombreDeIcono } from '../../../../shared/components/icono/icono';

type Estado = 'confirmado' | 'reservado' | 'espera' | 'bloqueado' | 'clase';

interface Bloque {
  readonly columna: number;
  /** Fila de inicio: 1 = 08:00, cada fila son 30 minutos. */
  readonly desde: number;
  readonly filas: number;
  readonly hora: string;
  readonly titulo: string;
  readonly detalle: string;
  readonly estado: Estado;
}

const ESTADOS: Record<Estado, { readonly palabra: string; readonly icono: NombreDeIcono }> = {
  confirmado: { palabra: 'Confirmado', icono: 'tilde' },
  reservado: { palabra: 'Reservado', icono: 'horarios' },
  espera: { palabra: 'En espera', icono: 'perfil' },
  bloqueado: { palabra: 'Bloqueado', icono: 'candado' },
  clase: { palabra: 'Clase', icono: 'actividades' },
};

/** Datos inventados: ninguna persona real (PRODUCT.md, "Evidence on Hand"). */
const BLOQUES: readonly Bloque[] = [
  {
    columna: 1,
    desde: 1,
    filas: 1,
    hora: '08:00',
    titulo: 'Marta Gómez',
    detalle: 'Rehabilitación de rodilla',
    estado: 'confirmado',
  },
  {
    columna: 1,
    desde: 2,
    filas: 2,
    hora: '08:30',
    titulo: 'Lucía Benítez',
    detalle: 'Esguince de tobillo · sesión 4 de 10',
    estado: 'confirmado',
  },
  {
    columna: 1,
    desde: 4,
    filas: 1,
    hora: '09:30',
    titulo: 'Julián Ríos',
    detalle: 'Lumbalgia',
    estado: 'espera',
  },
  {
    columna: 1,
    desde: 6,
    filas: 1,
    hora: '10:30',
    titulo: 'Raúl Medina',
    detalle: 'Cervicalgia',
    estado: 'reservado',
  },
  {
    columna: 2,
    desde: 1,
    filas: 2,
    hora: '08:00',
    titulo: 'Reunión de equipo',
    detalle: 'Agenda cerrada',
    estado: 'bloqueado',
  },
  {
    columna: 2,
    desde: 3,
    filas: 1,
    hora: '09:00',
    titulo: 'Ana Ferreyra',
    detalle: 'Evaluación inicial',
    estado: 'confirmado',
  },
  {
    columna: 2,
    desde: 5,
    filas: 2,
    hora: '10:00',
    titulo: 'Carlos Núñez',
    detalle: 'Hombro, post quirúrgico',
    estado: 'reservado',
  },
  {
    columna: 3,
    desde: 2,
    filas: 2,
    hora: '08:30',
    titulo: 'Pilates reformer',
    detalle: '8 de 10 lugares',
    estado: 'clase',
  },
  {
    columna: 3,
    desde: 6,
    filas: 2,
    hora: '10:30',
    titulo: 'Yoga',
    detalle: '12 de 15 lugares',
    estado: 'clase',
  },
];

/**
 * La agenda de un martes cualquiera, armada con los tokens del sistema: es la "captura" de la
 * portada (§4.2 del plan de la landing) sin una imagen que se desactualice con cada cambio de
 * diseño. Es ilustración: el lector de pantalla escucha la descripción, no la grilla.
 */
@Component({
  selector: 'app-agenda-de-muestra',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icono],
  templateUrl: './agenda-de-muestra.html',
  styleUrl: './agenda-de-muestra.css',
})
export class AgendaDeMuestra {
  protected readonly bloques = BLOQUES;
  protected readonly estados = ESTADOS;
  protected readonly horas = [
    '08:00',
    '08:30',
    '09:00',
    '09:30',
    '10:00',
    '10:30',
    '11:00',
    '11:30',
  ];
}
