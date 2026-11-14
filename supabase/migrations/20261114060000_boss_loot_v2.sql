-- Challenger Rips: premium Boss Loot packs, price-backed odds, server snapshots and GE sales.
-- Depends on the original catalog, case batch and fixed listing price migrations.
alter table rips.cases
  add column if not exists theme text not null default 'classic',
  add column if not exists accent text not null default '#a786df',
  add column if not exists symbol text not null default '⚔',
  add column if not exists description text not null default '',
  add column if not exists target_return numeric(5,4) not null default 0.72,
  add column if not exists config_version integer not null default 1;
alter table rips.cases add constraint cases_target_return_range check (target_return between 0.10 and 1.00);
alter table rips.batch_rewards
  add column if not exists odds_weight integer,
  add column if not exists guide_at_purchase bigint,
  add column if not exists odds_version integer;
alter table rips.batches add column if not exists config_version integer;

insert into rips.cases(id,pack,name,price,theme,accent,symbol,description,target_return)
values
('boss-starter','boss','Starter Loot',1000,'bronze','#ce834d','⚔','Your first adventure begins here.',0.72),
('boss-select','boss','Adventurer Loot',5000,'iron','#a5bbc3','🛡','Forged for the next challenge.',0.72),
('boss-warrior','boss','Warrior Loot',10000,'steel','#94c8d7','⚒','Earn your place in battle.',0.72),
('boss-champion','boss','Champion Loot',25000,'mithril','#4c9fa9','✦','Equipment worthy of a champion.',0.72),
('boss-elite','boss','Elite Loot',50000,'adamant','#72b38c','◆','A refined arsenal for elite fighters.',0.72),
('boss-legendary','boss','Legendary Loot',100000,'rune','#579df1','ᚱ','Runic relics of Gielinor.',0.72),
('boss-dragon','boss','Dragon Loot',250000,'dragon','#e46056','♜','Treasure forged in dragonfire.',0.72),
('boss-slayer','boss','Boss Slayer Loot',500000,'ancient','#ac85db','☠','Rewards for fearless boss slayers.',0.72),
('boss-premium','boss','Mythic Loot',1000000,'infernal','#fa8d46','🔥','A sealed infernal treasure.',0.72),
('boss-god','boss','God Tier Loot',5000000,'divine','#f7ca72','✧','The highest tier of legendary spoils.',0.72)
on conflict(id) do update set
 name=excluded.name,price=excluded.price,theme=excluded.theme,
 accent=excluded.accent,symbol=excluded.symbol,description=excluded.description,
 target_return=excluded.target_return;

-- Choose real GE-backed items close to each tier's target value, plus one jackpot.
-- Existing user inventory and previously purchased batch contents are preserved.
delete from rips.case_rewards where case_id in (select id from rips.cases where pack='boss');
with candidate as (
 select c.id case_id,i.id item,
 row_number() over(partition by c.id order by abs(ln(i.guide::numeric/(c.price*0.62))),i.guide,i.id) rn
 from rips.cases c join rips.catalog i on i.pack='boss'
 where c.pack='boss' and i.ge_id is not null and i.guide>0
)
insert into rips.case_rewards(case_id,item,weight,chase)
select case_id,item,1,false from candidate where rn<=9;
insert into rips.case_rewards(case_id,item,weight,chase)
select c.id,jackpot.id,1,true from rips.cases c
cross join lateral (
 select i.id from rips.catalog i where i.pack='boss' and i.guide>c.price*2
 and not exists(select 1 from rips.case_rewards r where r.case_id=c.id and r.item=i.id)
 order by abs(ln(i.guide::numeric/(c.price*10))),i.guide,i.id limit 1
) jackpot where c.pack='boss';

create or replace function rips.rebalance_boss_odds() returns void
language plpgsql security invoker set search_path='' as $fn$
declare c record; minimum double precision; alpha double precision;
lo double precision; hi double precision; expected double precision; k integer; changed integer;
begin
 for c in select id,price,target_return from rips.cases where pack='boss' loop
   select min(greatest(i.guide,1))::double precision into minimum
   from rips.case_rewards r join rips.catalog i on i.id=r.item
   where r.case_id=c.id and not r.chase;
   if minimum is null or (select count(*) from rips.case_rewards where case_id=c.id and chase)<>1
     then raise exception 'Invalid rewards for case %',c.id; end if;
   lo:=0;hi:=12;
   for k in 1..32 loop
     alpha:=(lo+hi)/2;
     select sum(i.guide::double precision*exp(-alpha*ln(i.guide::double precision/minimum)))/
       sum(exp(-alpha*ln(i.guide::double precision/minimum))) into expected
     from rips.case_rewards r join rips.catalog i on i.id=r.item where r.case_id=c.id and not r.chase;
     if expected>c.price*c.target_return then lo:=alpha; else hi:=alpha; end if;
   end loop;
   alpha:=(lo+hi)/2;
   with scores as (
     select r.case_id,r.item,exp(-alpha*ln(i.guide::double precision/minimum)) score
     from rips.case_rewards r join rips.catalog i on i.id=r.item
     where r.case_id=c.id and not r.chase
   ), quotas as (
     select *,1+(999999-count(*) over())*score/sum(score) over() quota from scores
   ), basis as (
     select *,floor(quota)::integer base,
     row_number() over(order by quota-floor(quota) desc,item) rank from quotas
   ), chosen as (
     select *,999999-sum(base) over() remainder from basis
   )
   update rips.case_rewards r
   set weight=x.base+case when x.rank<=x.remainder then 1 else 0 end
   from chosen x where r.case_id=x.case_id and r.item=x.item
   and r.weight is distinct from x.base+case when x.rank<=x.remainder then 1 else 0 end;
   get diagnostics changed=row_count;
   update rips.case_rewards set weight=1 where case_id=c.id and chase and weight<>1;
   if changed>0 then update rips.cases set config_version=config_version+1 where id=c.id; end if;
   if (select sum(weight) from rips.case_rewards where case_id=c.id)<>1000000
     then raise exception 'Invalid total odds for %',c.id; end if;
 end loop;
end $fn$;
revoke all on function rips.rebalance_boss_odds() from public,anon,authenticated;
select rips.rebalance_boss_odds();

-- Snapshot odds and server-side quote at purchase so later price changes don't rewrite history.
create or replace function rips.capture_boss_reward() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 select r.weight,c.guide,b.config_version into new.odds_weight,new.guide_at_purchase,new.odds_version
 from rips.batches b join rips.case_rewards r on r.case_id=b.case_id and r.item=new.item
 join rips.catalog c on c.id=new.item where b.id=new.batch;
 return new;
end $fn$;
drop trigger if exists capture_boss_reward on rips.batch_rewards;
create trigger capture_boss_reward before insert on rips.batch_rewards
for each row execute function rips.capture_boss_reward();

create or replace function rips.capture_case_version() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
 select config_version into new.config_version from rips.cases where id=new.case_id;
 return new;
end $fn$;
drop trigger if exists capture_case_version on rips.batches;
create trigger capture_case_version before insert on rips.batches
for each row execute function rips.capture_case_version();

-- Extend the preexisting authenticated case endpoint without changing its purchase logic.
do $$
declare src text;
begin
 select pg_get_functiondef('rips.command(text,jsonb)'::regprocedure) into src;
 src:=replace(src,'''name'',c.name,''price'',c.price,',
   '''name'',c.name,''price'',c.price,''theme'',c.theme,''accent'',c.accent,''symbol'',c.symbol,''description'',c.description,''targetReturn'',c.target_return,''configVersion'',c.config_version,');
 if src not like '%''configVersion''%' then raise exception 'Case metadata patch failed'; end if;
 execute src;
end $$;

-- Service-only, globally throttled GE quote synchronization, compatible with RLS.
create table if not exists rips.ge_refresh_status (
 id integer primary key default 1 check(id=1),
 last_attempt timestamptz,
 last_success timestamptz
);
insert into rips.ge_refresh_status(id) values(1) on conflict do nothing;
alter table rips.ge_refresh_status enable row level security;

create or replace function public.rips_claim_ge_refresh()
returns boolean language plpgsql security definer set search_path='' as $fn$
declare allowed boolean;
begin
 if auth.role()<>'service_role' then raise exception 'Not authorized'; end if;
 update rips.ge_refresh_status set last_attempt=now()
 where id=1 and (last_attempt is null or last_attempt<now()-interval '15 minutes')
 returning true into allowed;
 return coalesce(allowed,false);
end $fn$;
create or replace function public.rips_ge_ids()
returns integer[] language sql security definer set search_path='' as $fn$
select coalesce(array_agg(distinct ge_id),array[]::integer[])
from rips.catalog where ge_id is not null
$fn$;
create or replace function public.rips_mark_ge_refresh()
returns void language plpgsql security definer set search_path='' as $fn$
begin
 if auth.role()<>'service_role' then raise exception 'Not authorized'; end if;
 update rips.ge_refresh_status set last_success=now() where id=1;
end $fn$;
create or replace function public.rips_apply_ge_quotes(quotes jsonb)
returns integer language plpgsql security definer set search_path='' as $fn$
declare changed integer;
begin
 if auth.role()<>'service_role' then raise exception 'Not authorized'; end if;
 if jsonb_typeof(quotes)<>'array' or jsonb_array_length(quotes)>10000
   then raise exception 'Invalid GE quote payload'; end if;
 with incoming as (
   select distinct on (ge_id) ge_id,guide,guide_time from jsonb_to_recordset(quotes)
   as v(ge_id integer,guide bigint,guide_time timestamptz)
   where ge_id>0 and guide>0 and guide_time between now()-interval '7 days' and now()+interval '5 minutes'
   order by ge_id,guide_time desc
 )
 update rips.catalog c set guide=v.guide,guide_time=v.guide_time
 from incoming v where c.ge_id=v.ge_id and
 (c.guide_time is null or c.guide_time<v.guide_time);
 get diagnostics changed=row_count;
 if changed>0 then
   update rips.listings l set price=c.guide
   from rips.items i join rips.catalog c on c.id=i.item
   where l.instance=i.id and l.price is distinct from c.guide and c.ge_id is not null;
   perform rips.rebalance_boss_odds();
 end if;
 return changed;
end $fn$;
revoke all on function public.rips_claim_ge_refresh() from public,anon,authenticated;
revoke all on function public.rips_ge_ids() from public,anon,authenticated;
revoke all on function public.rips_mark_ge_refresh() from public,anon,authenticated;
revoke all on function public.rips_apply_ge_quotes(jsonb) from public,anon,authenticated;
grant execute on function public.rips_claim_ge_refresh() to service_role;
grant execute on function public.rips_ge_ids() to service_role;
grant execute on function public.rips_mark_ge_refresh() to service_role;
grant execute on function public.rips_apply_ge_quotes(jsonb) to service_role;

-- Instant sales are strictly owner-authorized and always use a fresh server-controlled GE quote.
do $$
declare src text;
begin
 select pg_get_functiondef('rips.economy_command(text,jsonb)'::regprocedure) into src;
 src:=replace(src,'    when ''buy'',''cancel'' then',
$insert$    when 'sell' then
      target := (payload->>'id')::uuid;
      select * into asset from rips.items where id=target and owner=uid for update;
      if asset.id is null then raise exception 'You do not own this item.'; end if;
      if exists(select 1 from rips.listings where instance=target) then raise exception 'Cancel the listing first.'; end if;
      select guide into amount from rips.catalog
      where id=asset.item and ge_id is not null
        and guide>0 and guide_time>now()-interval '24 hours';
      if amount is null then raise exception 'Current Grand Exchange price unavailable. Try again after price refresh.'; end if;
      delete from rips.items where id=target;
      update rips.players set gp=gp+amount where id=uid;
      insert into rips.sales(item,price) values(asset.item,amount);
    when 'buy','cancel' then$insert$);
 if src not like '%when ''sell'' then%' then raise exception 'GE instant sell patch failed'; end if;
 execute src;
end $$;
