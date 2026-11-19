-- ============================================================================
-- Marca configurable (logo y color), datos para la remisión y estadísticas de
-- ventas para las gráficas del tablero.
-- ============================================================================

alter table ajustes
  add column color_acento     text not null default '#0f766e' check (color_acento ~ '^#[0-9a-fA-F]{6}$'),
  add column logo             text check (logo is null or (logo ~ '^data:image/(png|jpeg|webp);base64,' and length(logo) <= 300000)),
  add column razon_social     text check (length(razon_social) <= 120),
  add column rfc              text check (length(rfc) <= 13),
  add column direccion        text check (length(direccion) <= 200),
  add column telefono         text check (length(telefono) <= 30),
  add column leyenda_remision text not null default 'Precios con IVA incluido. Este documento no es un comprobante fiscal.'
                                   check (length(leyenda_remision) <= 300);

-- ---------------------------------------------------------------------------
-- El cliente recibe la marca y los datos del negocio (nunca costos).
-- ---------------------------------------------------------------------------
create or replace function cliente_por_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cliente',      jsonb_build_object('nombre', c.nombre, 'direccion', c.direccion,
                                       'horario_recepcion', c.horario_recepcion, 'instrucciones', c.instrucciones),
    'negocio',      (select jsonb_build_object(
                       'nombre', nombre_negocio, 'whatsapp', whatsapp, 'color', color_acento, 'logo', logo,
                       'razon_social', razon_social, 'rfc', rfc, 'direccion', direccion, 'telefono', telefono,
                       'leyenda_remision', leyenda_remision)
                     from ajustes where id = 1),
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

revoke all on function cliente_por_token(text) from public;
grant execute on function cliente_por_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Estadísticas de ventas por fecha de entrega (sin cancelados). Solo admin.
-- Se calcula en el servidor para no depender del límite de filas de la API.
-- ---------------------------------------------------------------------------
create or replace function estadisticas_ventas(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_dias int;
  v_res  jsonb;
begin
  if not es_admin() then
    raise exception 'Solo el administrador puede ver las estadísticas.';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Periodo inválido.';
  end if;
  v_dias := p_hasta - p_desde + 1;
  if v_dias > 366 then
    raise exception 'El periodo no puede pasar de un año.';
  end if;

  with pedidos_validos as (
    select pe.id, pe.fecha_entrega, pe.cliente_id,
           coalesce((select sum(l.importe) from pedido_lineas l where l.pedido_id = pe.id), 0) as total
    from pedidos pe
    where pe.estado <> 'cancelado' and pe.fecha_entrega between p_desde - v_dias and p_hasta
  ),
  actual   as (select * from pedidos_validos where fecha_entrega >= p_desde),
  anterior as (select * from pedidos_validos where fecha_entrega <  p_desde)
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'por_dia', (
      select jsonb_agg(jsonb_build_object(
               'fecha', d::date,
               'total', coalesce((select sum(a.total) from actual a where a.fecha_entrega = d::date), 0),
               'pedidos', (select count(*) from actual a where a.fecha_entrega = d::date)) order by d)
      from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') d),
    'totales', (
      select jsonb_build_object('total', coalesce(sum(total), 0), 'pedidos', count(*),
                                'ticket_promedio', case when count(*) > 0 then round(sum(total) / count(*), 2) else 0 end)
      from actual),
    'periodo_anterior', (
      select jsonb_build_object('total', coalesce(sum(total), 0), 'pedidos', count(*),
                                'ticket_promedio', case when count(*) > 0 then round(sum(total) / count(*), 2) else 0 end)
      from anterior),
    'top_clientes', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', t.nombre, 'total', t.total, 'pedidos', t.pedidos) order by t.total desc, t.nombre)
      from (select c.nombre, sum(a.total) as total, count(*) as pedidos
            from actual a join clientes c on c.id = a.cliente_id
            group by c.id, c.nombre order by sum(a.total) desc, c.nombre limit 5) t), '[]'::jsonb),
    'top_productos', coalesce((
      select jsonb_agg(jsonb_build_object('nombre', t.nombre, 'total', t.total, 'cantidad', t.cantidad) order by t.total desc, t.nombre)
      from (select l.producto_nombre as nombre, sum(l.importe) as total, sum(l.cantidad) as cantidad
            from actual a join pedido_lineas l on l.pedido_id = a.id
            group by l.producto_nombre order by sum(l.importe) desc nulls last, l.producto_nombre limit 5) t), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

revoke all on function estadisticas_ventas(date, date) from public, anon;
grant execute on function estadisticas_ventas(date, date) to authenticated;
