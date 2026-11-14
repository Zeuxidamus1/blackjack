-- Inventory multi-select: owner-authorized, atomic GE bulk sale.
-- Preserves all existing account data. Same server quote validation as individual sales.
CREATE OR REPLACE FUNCTION rips.sell_inventory_bulk(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  wanted uuid[];
  item_count integer;
  valid_count integer;
  reward_total bigint;
  current_gp bigint;
  deleted_count integer;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if jsonb_typeof(payload->'ids') is distinct from 'array'
     or jsonb_array_length(payload->'ids') not between 1 and 100 then
    raise exception 'Select between 1 and 100 inventory items.';
  end if;

  select array_agg(value::uuid) into wanted
  from jsonb_array_elements_text(payload->'ids') as submitted(value);

  item_count := cardinality(wanted);
  if item_count is null or (select count(distinct id) from unnest(wanted) as ids(id)) <> item_count then
    raise exception 'Select each inventory item only once.';
  end if;

  -- Serialized with other inventory writes by the caller, independently safe
  -- if invoked by another privileged server routine later.
  perform pg_advisory_xact_lock(194712855);

  select count(*) into valid_count
  from rips.items i where i.id=any(wanted) and i.owner=uid;
  if valid_count<>item_count then
    raise exception 'One or more selected items are not in your inventory. Refresh and retry.';
  end if;

  if exists(select 1 from rips.listings l where l.instance=any(wanted)) then
    raise exception 'Cancel active listings before selling these items.';
  end if;
  if exists(
    select 1 from rips.batch_rewards r
    where r.instance=any(wanted) and r.reward_status='pending'
  ) then
    raise exception 'Finish reviewing pack rewards before selling them from inventory.';
  end if;

  select count(*),coalesce(sum(c.guide),0)::bigint into valid_count,reward_total
  from rips.items i join rips.catalog c on c.id=i.item
  where i.id=any(wanted) and i.owner=uid
    and c.ge_id is not null and c.guide>0
    and c.guide_time>now()-interval '24 hours';
  if valid_count<>item_count then
    raise exception 'One or more items have no current Grand Exchange quote. Refresh prices and retry.';
  end if;

  select gp into current_gp from rips.players where id=uid for update;
  if current_gp is null then raise exception 'Create a player first.'; end if;
  if current_gp+reward_total>9000000000000::bigint then
    raise exception 'Sale would exceed the maximum GP balance.';
  end if;

  -- Every item is logged at the authoritative quote in this transaction.
  -- If a later statement fails, Postgres rolls back the entire batch.
  insert into rips.sales(item,price)
  select i.item,c.guide
  from rips.items i join rips.catalog c on c.id=i.item
  where i.id=any(wanted) and i.owner=uid;

  delete from rips.items i where i.id=any(wanted) and i.owner=uid;
  get diagnostics deleted_count = row_count;
  if deleted_count<>item_count then
    raise exception 'Inventory changed while completing the sale. No items were sold.';
  end if;

  update rips.players set gp=gp+reward_total where id=uid;
  return jsonb_build_object('count',item_count,'total',reward_total);
end;
$function$
;
revoke all on function rips.sell_inventory_bulk(jsonb) from public,anon,authenticated;

do $patch$
declare source text;
begin
  select pg_get_functiondef('rips.economy_command(text,jsonb)'::regprocedure)
    into source;
  if source not like '%when ''sell_bulk'' then return rips.sell_inventory_bulk(payload);%' then
    source:=replace(source,
      '    when ''sell'' then',
      '    when ''sell_bulk'' then return rips.sell_inventory_bulk(payload);
    when ''sell'' then');
    if source not like '%when ''sell_bulk'' then return rips.sell_inventory_bulk(payload);%' then
      raise exception 'Unable to add authenticated bulk-sale route.';
    end if;
    execute source;
  end if;
end
$patch$;
