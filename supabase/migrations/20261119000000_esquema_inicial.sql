-- ============================================================================
-- Sistema de pedidos para clientes (restaurantes, cafeterías, dark kitchens…)
-- Versión 1: catálogo, clientes con sucursales, pedidos con estados.
--
-- Seguridad:
--   * Los clientes NO tienen acceso a las tablas. Solo pueden usar tres funciones
--     (cliente_por_token, pedidos_por_token, crear_pedido) con el código secreto
--     de su link.
--   * El panel de administración requiere iniciar sesión (Supabase Auth) y que el
--     usuario esté registrado en la tabla `administradores`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Ajustes generales (una sola fila)
-- ---------------------------------------------------------------------------
create table ajustes (
  id             int primary key default 1 check (id = 1),
  nombre_negocio text not null default 'PROVEEDOR',
  whatsapp       text check (whatsapp ~ '^[0-9]{10,15}$'),  -- solo dígitos, con lada de país: 5215512345678
  hora_corte     time,                                       -- null = sin hora de corte
  zona_horaria   text not null default 'America/Mexico_City'
);
insert into ajustes default values;

-- ---------------------------------------------------------------------------
-- Administradores
-- ---------------------------------------------------------------------------
create table administradores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  creado  timestamptz not null default now()
);

create function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from administradores where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------
create table productos (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null check (length(trim(nombre)) > 0),
  categoria    text not null default 'General',
  presentacion text not null default '',          -- «Bolsa 1 kg», «Caja 12 piezas»…
  unidad       text not null default 'pieza'
               check (unidad in ('pieza', 'kilo', 'litro', 'caja', 'costal', 'bulto', 'paquete')),
  activo       boolean not null default true,
  creado       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Clientes y sucursales
-- ---------------------------------------------------------------------------
create table clientes (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null check (length(trim(nombre)) > 0),
  tipo              text,                      -- restaurante, cafetería, dark kitchen…
  telefono          text,
  direccion         text,
  horario_recepcion text,
  instrucciones     text,                      -- «entrar por la puerta trasera…»
  token             text not null unique default replace(gen_random_uuid()::text, '-', ''),
  activo            boolean not null default true,
  creado            timestamptz not null default now()
);

create table sucursales (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes (id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  direccion  text,
  orden      int not null default 0
);
create index on sucursales (cliente_id);

-- Productos que puede pedir cada cliente
create table cliente_productos (
  cliente_id  uuid not null references clientes (id) on delete cascade,
  producto_id uuid not null references productos (id) on delete cascade,
  primary key (cliente_id, producto_id)
);

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create type estado_pedido as enum ('recibido', 'confirmado', 'en_ruta', 'entregado', 'cancelado');

create table pedidos (
  id            uuid primary key default gen_random_uuid(),
  folio         bigint generated always as identity unique,
  cliente_id    uuid not null references clientes (id) on delete restrict,
  fecha_entrega date not null,
  estado        estado_pedido not null default 'recibido',
  notas         text not null default '' check (length(notas) <= 500),
  creado        timestamptz not null default now(),
  actualizado   timestamptz not null default now()
);
-- Un pedido por cliente y por día (los cancelados no cuentan)
create unique index pedidos_uno_por_dia on pedidos (cliente_id, fecha_entrega) where estado <> 'cancelado';
create index on pedidos (fecha_entrega);

create table pedido_lineas (
  id              bigint generated always as identity primary key,
  pedido_id       uuid not null references pedidos (id) on delete cascade,
  sucursal_id     uuid references sucursales (id) on delete set null,
  sucursal_nombre text not null default '',
  producto_id     uuid references productos (id) on delete set null,
  producto_nombre text not null,               -- copia: el pedido no cambia si editas el catálogo
  presentacion    text not null default '',
  unidad          text not null,
  cantidad        int not null check (cantidad between 1 and 999)
);
create index on pedido_lineas (pedido_id);

create function tocar_actualizado() returns trigger language plpgsql as $$
begin
  new.actualizado := now();
  return new;
end $$;

create trigger pedidos_actualizado before update on pedidos
  for each row execute function tocar_actualizado();

-- ---------------------------------------------------------------------------
-- Permisos: solo administradores sobre las tablas
-- ---------------------------------------------------------------------------
alter table ajustes           enable row level security;
alter table administradores   enable row level security;
alter table productos         enable row level security;
alter table clientes          enable row level security;
alter table sucursales        enable row level security;
alter table cliente_productos enable row level security;
alter table pedidos           enable row level security;
alter table pedido_lineas     enable row level security;

create policy admin_todo on ajustes           for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_leer on administradores   for select to authenticated using (es_admin());
create policy admin_todo on productos         for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_todo on clientes          for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_todo on sucursales        for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_todo on cliente_productos for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_todo on pedidos           for all to authenticated using (es_admin()) with check (es_admin());
create policy admin_todo on pedido_lineas     for all to authenticated using (es_admin()) with check (es_admin());

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Funciones para el cliente (acceso con el código de su link)
-- ---------------------------------------------------------------------------

-- Primer día que se puede pedir: mañana, o pasado mañana si ya pasó la hora de corte.
create function fecha_minima_entrega() returns date
language sql stable security definer set search_path = public as $$
  select (l.ahora::date + 1
          + case when l.hora_corte is not null and l.ahora::time >= l.hora_corte then 1 else 0 end)
  from (select (now() at time zone zona_horaria) as ahora, hora_corte from ajustes where id = 1) l;
$$;

create function cliente_por_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cliente',      jsonb_build_object('nombre', c.nombre),
    'negocio',      (select jsonb_build_object('nombre', nombre_negocio, 'whatsapp', whatsapp) from ajustes where id = 1),
    'hoy',          (select (now() at time zone zona_horaria)::date from ajustes where id = 1),
    'fecha_minima', fecha_minima_entrega(),
    'sucursales',   coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre) order by s.orden, s.nombre)
      from sucursales s where s.cliente_id = c.id), '[]'::jsonb),
    'productos',    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'nombre', p.nombre, 'categoria', p.categoria,
               'presentacion', p.presentacion, 'unidad', p.unidad)
             order by p.categoria, p.nombre)
      from productos p
      join cliente_productos cp on cp.producto_id = p.id
      where cp.cliente_id = c.id and p.activo), '[]'::jsonb)
  )
  from clientes c
  where c.token = p_token and c.activo;
$$;

create function pedidos_por_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t.pedido order by t.fecha desc, t.folio desc), '[]'::jsonb)
  from (
    select pe.fecha_entrega as fecha, pe.folio,
           jsonb_build_object(
             'folio', pe.folio, 'fecha_entrega', pe.fecha_entrega, 'estado', pe.estado,
             'notas', pe.notas, 'creado', pe.creado,
             'lineas', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'sucursal', l.sucursal_nombre, 'producto', l.producto_nombre,
                        'presentacion', l.presentacion, 'unidad', l.unidad, 'cantidad', l.cantidad)
                      order by l.sucursal_nombre, l.producto_nombre)
               from pedido_lineas l where l.pedido_id = pe.id), '[]'::jsonb)
           ) as pedido
    from pedidos pe
    join clientes c on c.id = pe.cliente_id
    where c.token = p_token and c.activo
      and pe.fecha_entrega >= fecha_minima_entrega() - 31
  ) t;
$$;

-- p_lineas: [{"sucursal_id": uuid | null, "producto_id": uuid, "cantidad": int}, …]
create function crear_pedido(p_token text, p_fecha_entrega date, p_lineas jsonb, p_notas text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cliente      clientes%rowtype;
  v_pedido       pedidos%rowtype;
  v_linea        jsonb;
  v_prod         productos%rowtype;
  v_suc_id       uuid;
  v_suc_nombre   text;
  v_cantidad     int;
  v_con_sucursal boolean;
begin
  select * into v_cliente from clientes where token = p_token and activo;
  if not found then
    raise exception 'Link inválido o cliente inactivo. Contacta a tu proveedor.';
  end if;

  if p_fecha_entrega is null or p_fecha_entrega < fecha_minima_entrega() then
    raise exception 'Esa fecha de entrega ya no está disponible. Elige otra fecha.';
  end if;
  if p_fecha_entrega > fecha_minima_entrega() + 90 then
    raise exception 'Solo se puede pedir con hasta 90 días de anticipación.';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'El pedido no tiene productos.';
  end if;
  if jsonb_array_length(p_lineas) > 1000 then
    raise exception 'El pedido tiene demasiados renglones.';
  end if;
  if length(coalesce(p_notas, '')) > 500 then
    raise exception 'Las notas no pueden pasar de 500 caracteres.';
  end if;

  v_con_sucursal := exists (select 1 from sucursales where cliente_id = v_cliente.id);

  begin
    insert into pedidos (cliente_id, fecha_entrega, notas)
    values (v_cliente.id, p_fecha_entrega, coalesce(trim(p_notas), ''))
    returning * into v_pedido;
  exception when unique_violation then
    raise exception 'Ya tienes un pedido para ese día.';
  end;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_cantidad := (v_linea ->> 'cantidad')::int;
    if v_cantidad is null or v_cantidad < 1 or v_cantidad > 999 then
      raise exception 'Cantidad inválida.';
    end if;

    select p.* into v_prod
    from productos p
    join cliente_productos cp on cp.producto_id = p.id and cp.cliente_id = v_cliente.id
    where p.id = (v_linea ->> 'producto_id')::uuid and p.activo;
    if not found then
      raise exception 'Un producto del pedido ya no está disponible. Recarga la página.';
    end if;

    v_suc_id := null;
    v_suc_nombre := '';
    if v_linea ->> 'sucursal_id' is not null then
      select id, nombre into v_suc_id, v_suc_nombre
      from sucursales where id = (v_linea ->> 'sucursal_id')::uuid and cliente_id = v_cliente.id;
      if not found then
        raise exception 'Sucursal inválida. Recarga la página.';
      end if;
    elsif v_con_sucursal then
      raise exception 'Indica la sucursal de cada producto.';
    end if;

    insert into pedido_lineas (pedido_id, sucursal_id, sucursal_nombre, producto_id,
                               producto_nombre, presentacion, unidad, cantidad)
    values (v_pedido.id, v_suc_id, v_suc_nombre, v_prod.id,
            v_prod.nombre, v_prod.presentacion, v_prod.unidad, v_cantidad);
  end loop;

  return jsonb_build_object('folio', v_pedido.folio, 'fecha_entrega', v_pedido.fecha_entrega);
end $$;

-- Solo estas funciones quedan expuestas al público
revoke all on function es_admin()                                from public, anon;
revoke all on function tocar_actualizado()                       from public, anon, authenticated;
revoke all on function fecha_minima_entrega()                    from public;
revoke all on function cliente_por_token(text)                   from public;
revoke all on function pedidos_por_token(text)                   from public;
revoke all on function crear_pedido(text, date, jsonb, text)     from public;

grant execute on function es_admin()                             to authenticated;
grant execute on function fecha_minima_entrega()                 to anon, authenticated;
grant execute on function cliente_por_token(text)                to anon, authenticated;
grant execute on function pedidos_por_token(text)                to anon, authenticated;
grant execute on function crear_pedido(text, date, jsonb, text)  to anon, authenticated;
