-- ============================================================================
-- Venta a granel: cantidades con decimales (hasta 3) en productos por kilo o
-- litro. Los demás productos siguen siendo por pieza completa.
-- ============================================================================

-- importe es columna generada sobre cantidad: se quita, se cambia el tipo y se recrea.
alter table pedido_lineas drop column importe;
alter table pedido_lineas drop constraint if exists pedido_lineas_cantidad_check;
alter table pedido_lineas alter column cantidad type numeric(10, 3);
alter table pedido_lineas add constraint cantidad_valida check (cantidad > 0 and cantidad <= 9999);
alter table pedido_lineas
  add column importe numeric(12, 2) generated always as (round(cantidad * precio_unitario, 2)) stored;

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
  v_cantidad     numeric;
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
    begin
      v_cantidad := (v_linea ->> 'cantidad')::numeric;
    exception when others then
      raise exception 'Cantidad inválida.';
    end;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad > 999 or v_cantidad <> round(v_cantidad, 3) then
      raise exception 'Cantidad inválida.';
    end if;

    select p.* into v_prod
    from productos p
    join cliente_productos cp on cp.producto_id = p.id and cp.cliente_id = v_cliente.id
    where p.id = (v_linea ->> 'producto_id')::uuid and p.activo;
    if not found then
      raise exception 'Un producto del pedido ya no está disponible. Recarga la página.';
    end if;
    if v_prod.unidad not in ('kilo', 'litro') and v_cantidad <> trunc(v_cantidad) then
      raise exception 'Este producto solo se vende por pieza completa.';
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
    v_total := v_total + round(v_cantidad * v_precio, 2);
  end loop;

  return jsonb_build_object('folio', v_pedido.folio, 'fecha_entrega', v_pedido.fecha_entrega, 'total', v_total);
end $$;

revoke all on function crear_pedido(text, date, jsonb, text) from public;
grant execute on function crear_pedido(text, date, jsonb, text) to anon, authenticated;
