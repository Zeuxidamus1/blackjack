create schema rips;
create table rips.players (
  id uuid primary key references auth.users on delete cascade,
  name text not null check (char_length(name) between 2 and 24),
  gp bigint not null default 500000000 check (gp between 0 and 9000000000000),
  daily date
);
create table rips.catalog (
  id text primary key, pack text not null, weight integer not null,
  guide bigint not null, salvage bigint not null
);
insert into rips.catalog values
('bones','boss',6700,150000,100000),('rune','boss',2400,400000,250000),
('whip','boss',800,3000000,500000),('visage','boss',98,15000000,1000000),
('bow','boss',1,300000000,0),('ely','boss',1,500000000,0),
('sweets','clue',6700,150000,100000),('trim','clue',2400,400000,250000),
('boots','clue',800,6000000,500000),('gilded','clue',99,20000000,1000000),
('pick','clue',1,500000000,0),
('fish','pets',6700,150000,100000),('log','pets',2400,400000,250000),
('squirrel','pets',800,10000000,500000),('vorki','pets',99,35000000,1000000),
('olm','pets',1,400000000,0);
create table rips.pulls (
  owner uuid references rips.players on delete cascade, item text references rips.catalog,
  count integer not null default 1, first timestamptz not null default now(), primary key(owner,item)
);
create table rips.items (
  id uuid primary key default gen_random_uuid(), owner uuid not null references rips.players on delete cascade,
  item text not null references rips.catalog, origin uuid references rips.players on delete set null,
  acquired timestamptz not null default now(), pinned boolean not null default false
);
create index on rips.items(owner);
create table rips.listings (
  id uuid primary key default gen_random_uuid(),
  instance uuid unique not null references rips.items on delete cascade,
  price bigint not null check (price between 1000 and 1000000000),
  created timestamptz not null default now()
);
create table rips.sales (
  id bigint generated always as identity primary key, item text not null references rips.catalog,
  price bigint not null, sold timestamptz not null default now()
);
alter table rips.players enable row level security;
alter table rips.catalog enable row level security;
alter table rips.pulls enable row level security;
alter table rips.items enable row level security;
alter table rips.listings enable row level security;
alter table rips.sales enable row level security;

create function rips.command(action text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  today date := (now() at time zone 'UTC')::date;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if action <> 'state' and action <> 'showcase' then
    -- The beta has a small player pool. Serialize writes to settle each trade exactly once.
    perform pg_advisory_xact_lock(194712855);
  end if;
  select * into player from rips.players where id=uid;
  if action='join' then
    if char_length(btrim(coalesce(payload->>'name',''))) not between 2 and 24 then
      raise exception 'Enter a display name from 2 to 24 characters.';
    end if;
    insert into rips.players(id,name) values(uid,btrim(payload->>'name')) on conflict(id) do nothing;
    return '{}'::jsonb;
  end if;
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
    when 'state' then
      return jsonb_build_object(
        'id',uid,'name',player.name,'gp',player.gp,'daily',player.daily is distinct from today,
        'pulls',coalesce((select jsonb_object_agg(p.item,jsonb_build_object('count',p.count,'first',p.first))
          from rips.pulls p where p.owner=uid),'{}'::jsonb),
        'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'item',i.item,'pinned',i.pinned,
          'pulled',i.origin=uid,'acquired',i.acquired,'listing',l.id,'salvage',c.salvage) order by i.acquired desc)
          from rips.items i join rips.catalog c on c.id=i.item left join rips.listings l on l.instance=i.id
          where i.owner=uid),'[]'::jsonb),
        'market',coalesce((select jsonb_agg(to_jsonb(m)) from (
          select l.id,l.price,i.item,p.name,i.owner=uid as mine,c.guide,
            (select s.price from rips.sales s where s.item=i.item order by s.id desc limit 1) as recent
          from rips.listings l join rips.items i on i.id=l.instance
          join rips.players p on p.id=i.owner join rips.catalog c on c.id=i.item order by l.created desc
        ) m),'[]'::jsonb));
    when 'daily' then
      if player.daily=today then raise exception 'Daily GP already claimed.'; end if;
      update rips.players set gp=gp+2000000,daily=today where id=uid;
    when 'open' then
      cost := case payload->>'pack' when 'boss' then 1000000 when 'clue' then 5000000 when 'pets' then 5000000 end;
      if cost is null then raise exception 'Unknown pack.'; end if;
      if player.gp<cost then raise exception 'You need more GP.'; end if;
      ticket := floor(random()*10000)::integer;
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
        insert into rips.sales(item,price) values(asset.item,listing.price);
      end if;
      delete from rips.listings where id=listing.id;
    when 'list','pin','salvage' then
      target := (payload->>'id')::uuid;
      select * into asset from rips.items where id=target and owner=uid;
      if asset.id is null then raise exception 'You do not own this item.'; end if;
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
$$;
revoke all on function rips.command(text,jsonb) from public;
grant usage on schema rips to authenticated;
grant execute on function rips.command(text,jsonb) to authenticated;
create function public.rips_command(action text, payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select rips.command(action,payload);
$$;
revoke all on function public.rips_command(text,jsonb) from public, anon;
grant execute on function public.rips_command(text,jsonb) to authenticated;
