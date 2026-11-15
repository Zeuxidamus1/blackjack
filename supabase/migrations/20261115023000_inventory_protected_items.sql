-- Step 5 item protection. No wallet, inventory or pricing data is reset.
alter table rips.items add column if not exists protected boolean not null default false;

CREATE OR REPLACE FUNCTION rips.economy_command(action text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  uid uuid := auth.uid();
  player rips.players;
  asset rips.items;
  listing rips.listings;
  drop_item rips.catalog;
  target uuid;
  amount bigint;
  fee bigint;
  ticket integer;
  cost bigint;
  result jsonb;
  login_name text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if action <> 'state' and action <> 'showcase' then
    -- The beta has a small player pool. Serialize writes to settle each trade exactly once.
    perform pg_advisory_xact_lock(194712855);
  end if;
  select * into player from rips.players where id=uid;
  if player.id is null and action in ('state','join') then
    select username into login_name from private.challenger_usernames where user_id=uid;
    insert into rips.players(id,name) values(uid,coalesce(login_name,'Player-'||left(uid::text,8))) on conflict(id) do nothing;
    select * into player from rips.players where id=uid;
  end if;
  if action='join' then return '{}'::jsonb; end if;
  if action='showcase' then
    select jsonb_build_object('name',p.name,'items',coalesce((
      select jsonb_agg(jsonb_build_object('item',i.item,'pulled',i.origin=p.id,'acquired',i.acquired) order by i.acquired)
      from rips.items i where i.owner=p.id and i.pinned),'[]'::jsonb))
      into result from rips.players p where p.id=(payload->>'id')::uuid;
    if result is null then raise exception 'Showcase not found.'; end if;
    return result;
  end if;
  if player.id is null then
    if action='state' then return jsonb_build_object('needsProfile',true); end if;
    raise exception 'Create your player first.';
  end if;
  case action
    when 'catalog' then return rips.reward_catalog();
    when 'state' then
      return jsonb_build_object(
        'id',uid,'name',player.name,'gp',player.gp,'daily',coalesce(player.last_daily_claim + interval '24 hours' <= now(),true),
        'nextDailyAt',player.last_daily_claim + interval '24 hours','serverTime',now(),
        'pulls',coalesce((select jsonb_object_agg(p.item,jsonb_build_object('count',p.count,'first',p.first))
          from rips.pulls p where p.owner=uid),'{}'::jsonb),
        'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'item',i.item,'pinned',i.pinned,
          'pulled',i.origin=uid,'acquired',i.acquired,'protected',i.protected,'listing',l.id,'salvage',c.salvage) order by i.acquired desc)
          from rips.items i join rips.catalog c on c.id=i.item left join rips.listings l on l.instance=i.id
          where i.owner=uid
      and not exists (
        select 1 from rips.batch_rewards pending
        where pending.instance=i.id and pending.reward_status='pending'
      )),'[]'::jsonb),
        'market',coalesce((select jsonb_agg(to_jsonb(m)) from (
          select l.id,l.price,i.item,p.name,i.owner=uid as mine,c.guide,
            (select s.price from rips.sales s where s.item=i.item order by s.id desc limit 1) as recent
          from rips.listings l join rips.items i on i.id=l.instance
          join rips.players p on p.id=i.owner join rips.catalog c on c.id=i.item order by l.created desc
        ) m),'[]'::jsonb));
    when 'daily' then
      if player.last_daily_claim + interval '24 hours' > now() then raise exception 'Daily GP already claimed.'; end if;
      update rips.players set gp=gp+50000,last_daily_claim=now() where id=uid;
    when 'open' then
      cost := case payload->>'pack' when 'boss' then 1000000 when 'clue' then 5000000 when 'pets' then 5000000 end;
      if cost is null then raise exception 'Unknown pack.'; end if;
      if player.gp<cost then raise exception 'You need more GP.'; end if;
      ticket := floor(random()*(select sum(weight) from rips.catalog where pack=payload->>'pack'))::integer;
      for drop_item in select * from rips.catalog where pack=payload->>'pack' order by id loop
        ticket := ticket-drop_item.weight;
        exit when ticket<0;
      end loop;
      insert into rips.items(owner,item,origin) values(uid,drop_item.id,uid);
      insert into rips.pulls(owner,item) values(uid,drop_item.id)
      on conflict(owner,item) do update set count=rips.pulls.count+1 returning count into amount;
      fee := 0;
      if amount=1 and (select count(*) from rips.pulls where owner=uid)%3=0 then fee:=2000000; end if;
      update rips.players set gp=gp-cost+fee where id=uid;
      return jsonb_build_object('item',drop_item.id,'bonus',fee,'count',amount);
    when 'lock' then
      target := (payload->>'id')::uuid;
      select * into asset from rips.items where id=target and owner=uid for update;
      if asset.id is null then raise exception 'You do not own this item.'; end if;
      if exists(select 1 from rips.batch_rewards pending
        where pending.instance=target and pending.reward_status='pending')
      then raise exception 'Finish reviewing this reward before protecting it.'; end if;
      if exists(select 1 from rips.listings where instance=target)
      then raise exception 'Cancel the listing before changing item protection.'; end if;
      update rips.items set protected=not protected where id=target and owner=uid;
    when 'sell_bulk' then return rips.sell_inventory_bulk(payload);
    when 'sell' then
      target := (payload->>'id')::uuid;
      select * into asset from rips.items where id=target and owner=uid for update;
      if asset.id is null then raise exception 'You do not own this item.'; end if;
      if asset.protected then raise exception 'Unlock this protected item before selling it.'; end if;
      if exists (
        select 1 from rips.batch_rewards pending
        where pending.instance=target and pending.reward_status='pending'
      ) then raise exception 'Resolve this item in your pack rewards first.'; end if;
      if exists(select 1 from rips.listings where instance=target) then raise exception 'Cancel the listing first.'; end if;
      select guide into amount from rips.catalog
      where id=asset.item and ge_id is not null
        and guide>0 and guide_time>now()-interval '24 hours';
      if amount is null then raise exception 'Current Grand Exchange price unavailable. Try again after price refresh.'; end if;
      delete from rips.items where id=target;
      update rips.players set gp=gp+amount where id=uid;
      insert into rips.sales(item,price,seller) values(asset.item,amount,uid);
    when 'buy','cancel' then
      select * into listing from rips.listings where id=(payload->>'id')::uuid;
      if listing.id is null then raise exception 'This listing has closed.'; end if;
      select * into asset from rips.items where id=listing.instance;
      if action='cancel' then
        if asset.owner<>uid then raise exception 'Only the seller can cancel.'; end if;
      else
        if asset.owner=uid then raise exception 'You already own this item.'; end if;
        if player.gp<listing.price then raise exception 'You need more GP.'; end if;
        fee := listing.price*2/100;
        update rips.players set gp=gp-listing.price where id=uid;
        update rips.players set gp=gp+listing.price-fee where id=asset.owner;
        update rips.items set owner=uid,acquired=now(),pinned=false where id=asset.id;
        insert into rips.sales(item,price,seller) values(asset.item,listing.price,asset.owner);
      end if;
      delete from rips.listings where id=listing.id;
    when 'list','pin','salvage' then
      target := (payload->>'id')::uuid;
      select * into asset from rips.items where id=target and owner=uid;
      if asset.id is null then raise exception 'You do not own this item.'; end if;
      if asset.protected and action in ('list','salvage') then
        raise exception 'Unlock this protected item before listing or salvaging it.';
      end if;
      if exists (
        select 1 from rips.batch_rewards pending
        where pending.instance=target and pending.reward_status='pending'
      ) then raise exception 'Resolve this item in your pack rewards first.'; end if;
      if exists(select from rips.listings where instance=target) then raise exception 'Cancel the listing first.'; end if;
      if action='list' then
        amount := (payload->>'price')::bigint;
        if amount is null or amount not between 1000 and 1000000000 then
          raise exception 'Set a price between 1,000 and 1 billion GP.';
        end if;
        insert into rips.listings(instance,price) values(target,amount);
        update rips.items set pinned=false where id=target;
      elsif action='pin' then
        if not asset.pinned and (select count(*) from rips.items where owner=uid and pinned)>=5 then
          raise exception 'Your shelf holds five items.';
        end if;
        update rips.items set pinned=not asset.pinned where id=target;
      else
        select salvage into amount from rips.catalog where id=asset.item;
        if amount=0 or (select count(*) from rips.items where owner=uid and item=asset.item)<2 then
          raise exception 'Only eligible duplicates can be salvaged.';
        end if;
        delete from rips.items where id=target;
        update rips.players set gp=gp+amount where id=uid;
      end if;
    else raise exception 'Unknown action.';
  end case;
  return '{}'::jsonb;
end;
$function$
;
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
  if exists(select 1 from rips.items i where i.id=any(wanted) and i.owner=uid and i.protected) then
    raise exception 'Your selection includes protected items. Unlock them before selling.';
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
  insert into rips.sales(item,price,seller)
  select i.item,c.guide,uid
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
