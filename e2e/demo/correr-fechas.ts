import { execFileSync } from 'node:child_process';

/**
 * Corrimiento de fechas del Centro Demo (`sembrar-demo.spec.ts`).
 *
 * <p><b>Por qué existe.</b> La API no crea el pasado: un turno con fecha pasada es 409 `PASADO`
 * (DP-04) y la caja sólo abre la jornada de hoy. Para que el centro tenga meses de historia, cada
 * día simulado se siembra por la API —turnos en un día futuro, sesiones cerradas, deudas, cobros,
 * caja— y después este módulo corre a ese día pasado <b>sólo las filas que se crearon en ese
 * paso</b>: las de la organización demo con `id` mayor que la marca tomada antes de empezar.
 *
 * <p><b>La regla del corrimiento</b>, por valor y no por columna: una fecha anterior a hoy ya es
 * historia (la copió el paso de otra fila ya corrida) y no se toca; una de hoy es "cuando pasó" y
 * va al día objetivo; una posterior a hoy es "cuando está agendado" y se corre lo mismo que el
 * turno, para que el turno del día futuro caiga en el día objetivo. Así no hace falta clasificar
 * las ~470 columnas temporales del esquema.
 *
 * <p>Corre como `postgres` con `session_replication_role = replica`: así no saltan los triggers
 * de `updated_at` ni el que prohíbe modificar `audit_event`. Sólo para datos sintéticos de demo:
 * no es un camino del producto y nunca se usa contra una base que no sea de desarrollo.
 */

const CONTENEDOR = process.env['AKINE_DEMO_PG_CONTENEDOR'] ?? 'akine-postgres';
export const BASE = process.env['AKINE_DEMO_DB'] ?? 'akine_main';

/** Tablas de la organización que no se corren: la suscripción manda sobre el acceso al centro. */
const EXCLUIDAS = ['subscription', 'subscription_cobro', 'subscription_transition'];

export type Marcas = Record<string, number>;

export function psql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      CONTENEDOR,
      'psql',
      '-U',
      'postgres',
      '-d',
      BASE,
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

const TABLAS_DE_LA_ORGANIZACION = `
  select c.table_name from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
   and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.column_name = 'organization_id'
    and c.table_name not in (${EXCLUIDAS.map((t) => `'${t}'`).join(',')})
    and exists (select 1 from information_schema.columns i where i.table_schema = 'public'
                and i.table_name = c.table_name and i.column_name = 'id' and i.data_type = 'bigint')`;

let tablas: string[] | null = null;

function tablasDeLaOrganizacion(): string[] {
  tablas ??= psql(`${TABLAS_DE_LA_ORGANIZACION} order by 1;`).split('\n').filter(Boolean);
  return tablas;
}

/** El `max(id)` de cada tabla de la organización, para saber después qué creó el paso. */
export function marcas(organizationId: number): Marcas {
  const consulta = tablasDeLaOrganizacion()
    .map(
      (t) =>
        `select '${t}' as t, coalesce(max(id), 0) as m from "${t}" where organization_id = ${organizationId}`,
    )
    .join(' union all ');
  // `__inicio`: cuándo empezó el paso, para reconocer las filas viejas que el paso editó.
  const salida = psql(
    `select json_object_agg(t, m) from (${consulta} union all select '__inicio', (extract(epoch from now()) * 1000)::bigint) x;`,
  );
  return JSON.parse(salida) as Marcas;
}

export interface Corrimiento {
  readonly organizationId: number;
  readonly marcas: Marcas;
  /** Hoy en la sede, `YYYY-MM-DD`. */
  readonly hoy: string;
  /** Días que se corre lo que pasó hoy (hoy − objetivo). */
  readonly diasDeHoy: number;
  /** Días que se corre lo agendado después de hoy (día de los turnos − objetivo). */
  readonly diasDeLoAgendado: number;
  readonly timezone: string;
}

/** Corre al día objetivo las filas que creó el paso (ver la cabecera). */
export function correr(c: Corrimiento): void {
  const marcasJson = JSON.stringify(c.marcas).replace(/'/g, "''");
  psql(`
set session_replication_role = replica;
do $$
declare
  t text; sets text;
  wm jsonb := '${marcasJson}'::jsonb;
begin
  for t in ${TABLAS_DE_LA_ORGANIZACION} loop
    select string_agg(
      case when data_type = 'date' then format(
        '%1$I = case when %1$I is null or %1$I < %2$L::date then %1$I when %1$I = %2$L::date then %1$I - %3$s else %1$I - %4$s end',
        column_name, '${c.hoy}', ${c.diasDeHoy}, ${c.diasDeLoAgendado})
      else format(
        '%1$I = case when %1$I is null or (%1$I at time zone %5$L)::date < %2$L::date then %1$I '
        || 'when (%1$I at time zone %5$L)::date = %2$L::date then %1$I - make_interval(days => %3$s) '
        || 'else %1$I - make_interval(days => %4$s) end',
        column_name, '${c.hoy}', ${c.diasDeHoy}, ${c.diasDeLoAgendado}, '${c.timezone}')
      end, ', ')
    into sets
    from information_schema.columns
    where table_schema = 'public' and table_name = t and is_generated = 'NEVER'
      and data_type in ('date', 'timestamp with time zone');
    if sets is null then continue; end if;
    execute format('update %I set %s where organization_id = %s and id > %s',
                   t, sets, ${c.organizationId}, coalesce((wm ->> t)::bigint, 0));

    -- Filas de pasos anteriores que este paso editó (un lote que se concilia, una deuda que se
    -- cobra): sólo lo que quedó con fecha de hoy va al día objetivo; lo demás ya es historia.
    if exists (select 1 from information_schema.columns where table_schema = 'public'
               and table_name = t and column_name = 'updated_at') then
      select string_agg(
        case when data_type = 'date' then format(
          '%1$I = case when %1$I = %2$L::date then %1$I - %3$s else %1$I end',
          column_name, '${c.hoy}', ${c.diasDeHoy})
        else format(
          '%1$I = case when (%1$I at time zone %4$L)::date = %2$L::date '
          || 'then %1$I - make_interval(days => %3$s) else %1$I end',
          column_name, '${c.hoy}', ${c.diasDeHoy}, '${c.timezone}')
        end, ', ')
      into sets
      from information_schema.columns
      where table_schema = 'public' and table_name = t and is_generated = 'NEVER'
        and data_type in ('date', 'timestamp with time zone');
      execute format('update %I set %s where organization_id = %s and id <= %s '
                     || 'and updated_at >= to_timestamp(%s / 1000.0)',
                     t, sets, ${c.organizationId}, coalesce((wm ->> t)::bigint, 0),
                     (wm ->> '__inicio')::bigint);
    end if;
  end loop;
end $$;`);
}

/**
 * Horas creíbles para lo que el paso hizo "ahora": la sesión ocurre en el horario del turno, la
 * deuda nace al cerrarla, el cobro y su movimiento de caja unos minutos después, la reserva unos
 * días antes del turno y la caja abre a la mañana y cierra a la noche del día objetivo.
 */
export function ajustarHoras(
  organizationId: number,
  m: Marcas,
  objetivo: string,
  timezone: string,
): void {
  const o = organizationId;
  const id = (t: string) => m[t] ?? 0;
  const local = (hora: string) => `('${objetivo} ${hora}'::timestamp at time zone '${timezone}')`;
  psql(`
set session_replication_role = replica;
update turno t set
  reservado_en = ((((t.inicio at time zone '${timezone}')::date - (2 + (t.id % 9)::int)) + time '09:00' + make_interval(hours => (t.id % 10)::int, mins => (t.id * 7 % 60)::int)) at time zone '${timezone}'),
  created_at = ((((t.inicio at time zone '${timezone}')::date - (2 + (t.id % 9)::int)) + time '09:00' + make_interval(hours => (t.id % 10)::int, mins => (t.id * 7 % 60)::int)) at time zone '${timezone}'),
  confirmado_en = case when t.confirmado_en is null then null else t.inicio - interval '1 day' end,
  cancelado_en = case when t.cancelado_en is null then null else t.inicio - make_interval(hours => 5 + (t.id % 30)::int) end
where t.organization_id = ${o} and t.id > ${id('turno')};
update sesion s set
  iniciada_en = t.inicio + interval '2 minutes',
  evaluada_en = t.inicio + interval '15 minutes',
  borrador_guardado_en = t.inicio + interval '15 minutes',
  cerrada_en = t.fin - interval '3 minutes',
  created_at = t.inicio + interval '2 minutes',
  updated_at = t.fin - interval '3 minutes'
from turno t
where s.turno_id = t.id and s.organization_id = ${o} and s.id > ${id('sesion')};
update sesion_version v set registrada_en = s.cerrada_en
from sesion s where v.sesion_id = s.id and v.organization_id = ${o} and v.id > ${id('sesion_version')};
update obligacion b set devengada_en = s.cerrada_en, snapshot_capturado_en = s.cerrada_en,
  created_at = s.cerrada_en, updated_at = s.cerrada_en
from sesion s where b.sesion_id = s.id and b.organization_id = ${o} and b.id > ${id('obligacion')};
update cobro c set cobrado_en = x.cuando + interval '4 minutes',
  created_at = x.cuando + interval '4 minutes', updated_at = x.cuando + interval '4 minutes'
from (select i.cobro_id, max(b.devengada_en) cuando
      from cobro_imputacion i join obligacion b on b.id = i.obligacion_id
      where i.organization_id = ${o} group by i.cobro_id) x
where c.id = x.cobro_id and c.organization_id = ${o} and c.id > ${id('cobro')}
  and (x.cuando at time zone '${timezone}')::date = '${objetivo}'::date;
update cobro_imputacion i set imputada_en = c.cobrado_en, created_at = c.cobrado_en
from cobro c where i.cobro_id = c.id and i.organization_id = ${o} and i.id > ${id('cobro_imputacion')};
update cobro_medio d set created_at = c.cobrado_en
from cobro c where d.cobro_id = c.id and d.organization_id = ${o} and d.id > ${id('cobro_medio')};
update jornada_caja j set abierta_en = ${local('07:55')}, cerrada_en = case when j.cerrada_en is null then null else ${local('20:35')} end,
  created_at = ${local('07:55')}, updated_at = ${local('20:35')}
where j.organization_id = ${o} and j.id > ${id('jornada_caja')};
update movimiento_caja v set registrado_en = c.cobrado_en, created_at = c.cobrado_en
from cobro c where v.referencia_origen = c.id and v.tipo_origen = 'COBRO'
  and v.organization_id = ${o} and v.id > ${id('movimiento_caja')};
update movimiento_caja v set registrado_en = ${local('07:56')}, created_at = ${local('07:56')}
where v.organization_id = ${o} and v.id > ${id('movimiento_caja')} and v.tipo_origen = 'APERTURA';
`);
}

/**
 * Al final: las filas que un paso posterior editó (una deuda que se cobró después, una persona a la
 * que se le cargó la cobertura) quedaron con `updated_at` de hoy. Se les devuelve su `created_at`
 * para que nada histórico aparezca "modificado hoy".
 */
export function aplanarModificaciones(organizationId: number): void {
  psql(`
set session_replication_role = replica;
do $$
declare t text;
begin
  for t in ${TABLAS_DE_LA_ORGANIZACION} loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'updated_at')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'created_at') then
      execute format('update %I set updated_at = created_at where organization_id = %s '
        || 'and created_at < now() - interval ''1 day'' and updated_at > now() - interval ''1 day''',
        t, ${organizationId});
    end if;
  end loop;
end $$;`);
}
