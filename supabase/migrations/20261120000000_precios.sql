-- ============================================================================
-- Precios: precio base y costo en el catálogo, precio por cliente y precio
-- congelado en cada línea de pedido. Vista de resumen para el tablero.
-- ============================================================================

alter table productos
  add column precio_base numeric(10, 2) not null default 0 check (precio_base >= 0),
  add column costo       numeric(10, 2) check (costo >= 0);

alter table cliente_productos
  add column precio numeric(10, 2) not null default 0 check (precio >= 0);

update cliente_productos cp set precio = p.precio_base
from productos p where p.id = cp.producto_id;

alter table pedido_lineas
  add column precio_unitario numeric(10, 2) check (precio_unitario >= 0),
  add column importe numeric(12, 2) generated always as (cantidad * precio_unitario) stored;

alter table ajustes
  add column margen_minimo    numeric(5, 2) check (margen_minimo between 0 and 100),
  add column dias_inactividad int not null default 7 check (dias_inactividad between 1 and 365);

-- Resumen por cliente para el tablero (respeta RLS: solo administradores).
create view resumen_clientes with (security_invoker = on) as
select c.id, c.nombre, c.telefono, c.activo,
       (select max(p.fecha_entrega) from pedidos p where p.cliente_id = c.id and p.estado <> 'cancelado') as ultima_entrega,
       (select max(p.creado)        from pedidos p where p.cliente_id = c.id and p.estado <> 'cancelado') as ultimo_pedido,
       (select count(*) from cliente_productos cp where cp.cliente_id = c.id)::int                     as productos,
       (select count(*) from cliente_productos cp where cp.cliente_id = c.id and cp.precio = 0)::int   as productos_sin_precio
from clientes c;

revoke all on resumen_clientes from anon;
grant select on resumen_clientes to authenticated;

-- ---------------------------------------------------------------------------
-- Funciones del cliente con precios
-- ---------------------------------------------------------------------------
create or replace function cliente_por_token(p_token text) returns jsonb
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
               'presentacion', p.presentacion, 'unidad', p.unidad, 'precio', cp.precio)
             order by p.categoria, p.nombre)
      from productos p
      join cliente_productos cp on cp.producto_id = p.id
      where cp.cliente_id = c.id and p.activo), '[]'::jsonb)
  )
  from clientes c
  where c.token = p_token and c.activo;
$$;

create or replace function pedidos_por_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(t.pedido order by t.fecha desc, t.folio desc), '[]'::jsonb)
  from (
    select pe.fecha_entrega as fecha, pe.folio,
           jsonb_build_object(
             'folio', pe.folio, 'fecha_entrega', pe.fecha_entrega, 'estado', pe.estado,
             'notas', pe.notas, 'creado', pe.creado,
             'total', (select sum(l.importe) from pedido_lineas l where l.pedido_id = pe.id),
             'lineas', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'sucursal', l.sucursal_nombre, 'producto', l.producto_nombre,
                        'presentacion', l.presentacion, 'unidad', l.unidad, 'cantidad', l.cantidad,
                        'precio_unitario', l.precio_unitario, 'importe', l.importe)
                      order by l.sucursal_nombre, l.producto_nombre)
               from pedido_lineas l where l.pedido_id = pe.id), '[]'::jsonb)
           ) as pedido
    from pedidos pe
    join clientes c on c.id = pe.cliente_id
    where c.token = p_token and c.activo
      and pe.fecha_entrega >= fecha_minima_entrega() - 31
  ) t;
$$;

create or replace function crear_pedido(p_token text, p_fecha_entrega date, p_lineas jsonb, p_notas text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cliente      clientes%rowtype;
  v_pedido       pedidos%rowtype;
  v_linea        jsonb;
  v_prod         productos%rowtype;
  v_precio       numeric(10, 2);
  v_suc_id       uuid;
  v_suc_nombre   text;
  v_cantidad     int;
  v_con_sucursal boolean;
  v_total        numeric(12, 2) := 0;
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
    select precio into v_precio from cliente_productos
    where cliente_id = v_cliente.id and producto_id = v_prod.id;
    if v_precio is null or v_precio <= 0 then
      raise exception 'Hay productos sin precio; contacta a tu proveedor.';
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
                               producto_nombre, presentacion, unidad, cantidad, precio_unitario)
    values (v_pedido.id, v_suc_id, v_suc_nombre, v_prod.id,
            v_prod.nombre, v_prod.presentacion, v_prod.unidad, v_cantidad, v_precio);
    v_total := v_total + v_cantidad * v_precio;
  end loop;

  return jsonb_build_object('folio', v_pedido.folio, 'fecha_entrega', v_pedido.fecha_entrega, 'total', v_total);
end $$;

revoke all on function cliente_por_token(text)                   from public;
revoke all on function pedidos_por_token(text)                   from public;
revoke all on function crear_pedido(text, date, jsonb, text)     from public;
grant execute on function cliente_por_token(text)                to anon, authenticated;
grant execute on function pedidos_por_token(text)                to anon, authenticated;
grant execute on function crear_pedido(text, date, jsonb, text)  to anon, authenticated;
