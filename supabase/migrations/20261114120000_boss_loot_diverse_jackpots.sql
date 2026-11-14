-- Challenger Rips Boss Loot v3: GE-backed item variety and true high-precision jackpots.
-- Only future prizes change. Existing wallet, inventory and batch rewards are preserved.
alter table rips.case_rewards alter column weight type bigint;
alter table rips.batch_rewards alter column odds_weight type bigint;

create or replace function rips.boss_jackpot_tickets(case_price bigint)
returns bigint language sql immutable set search_path='' as $$
 select greatest(10000::bigint, (case_price::numeric*10)::bigint)
$$;
revoke all on function rips.boss_jackpot_tickets(bigint) from public,anon,authenticated;

-- Bands: 14 low, 9 break even, 12 moderate profit, 7 good profit, 4 big wins,
-- 2 massive wins, plus one verified Twisted bow jackpot (49 unique items).
delete from rips.case_rewards r using rips.cases c where r.case_id=c.id and c.pack='boss';
with band(band,lo,hi,want,mid) as (
 values (1,0.04::numeric,0.50::numeric,14,0.22::numeric),
 (2,0.50,1.00,9,0.72),
 (3,1.00,2.50,12,1.55),
 (4,2.50,5.00,7,3.40),
 (5,5.00,10.00,4,7.0),
 (6,10.00,100.00,2,17.0)
), source as (
 select distinct on (i.ge_id) i.id,i.pack,i.ge_id,i.guide
 from rips.catalog i
 where i.ge_id is not null and i.guide>0 and i.id<>'bow'
 and i.guide_time is not null
 order by i.ge_id,case when i.pack='boss' then 0 else 1 end,i.id
), ranked as (
 select c.id case_id,s.id item,b.band,b.want,
 row_number() over(partition by c.id,b.band order by
  (case when s.pack='boss' then 0 else 0.25 end) +
  abs(ln(s.guide::double precision/(c.price*b.mid)::double precision)),
  md5(s.id||':'||c.id)) rn
 from rips.cases c cross join band b
 join source s on s.guide>c.price*b.lo and s.guide<=c.price*b.hi
 where c.pack='boss'
)
insert into rips.case_rewards(case_id,item,weight,chase)
select case_id,item,1::bigint,false from ranked where rn<=want;
insert into rips.case_rewards(case_id,item,weight,chase)
select c.id,i.id,1::bigint,true
from rips.cases c cross join rips.catalog i
where c.pack='boss' and i.ge_id=20997 and i.name='Twisted bow';

create or replace function rips.rebalance_boss_odds()
returns void language plpgsql security invoker set search_path='' as $fn$
declare
 c record; minimum float8; alpha float8; lo float8; hi float8;
 expected float8; jackpot_value float8; jackpot_ticket bigint;
 normal_tickets bigint; normal_count bigint; changed integer;
 idx integer; actual_value numeric; prize_count integer;
begin
 for c in select id,price,target_return from rips.cases where pack='boss' order by price loop
   select count(*), (min(i.guide) filter(where not r.chase))::float8
     into prize_count,minimum
   from rips.case_rewards r join rips.catalog i on i.id=r.item
   where r.case_id=c.id;
   if prize_count<25 or minimum is null then
      raise exception 'Insufficient real reward pool: % has only %',c.id,prize_count;
   end if;
   if minimum >= c.price*c.target_return then
      raise exception 'Pack % has no sufficiently affordable base reward',c.id;
   end if;
   select i.guide::float8 into strict jackpot_value
   from rips.case_rewards r join rips.catalog i on i.id=r.item
   where r.case_id=c.id and r.chase;
   jackpot_ticket:=rips.boss_jackpot_tickets(c.price);
   select count(*) into normal_count from rips.case_rewards
   where case_id=c.id and not chase;
   normal_tickets:=1000000000000::bigint-jackpot_ticket-normal_count;
   if normal_tickets<=0 then raise exception 'Jackpot uses all probability'; end if;
   lo:=0; hi:=32;
   for idx in 1..48 loop
     alpha:=(lo+hi)/2;
     select sum(i.guide::float8 * exp(-alpha*ln(i.guide::float8/minimum)))/
            sum(exp(-alpha*ln(i.guide::float8/minimum))) into expected
     from rips.case_rewards r join rips.catalog i on i.id=r.item
     where r.case_id=c.id and not r.chase;
     expected:=((normal_tickets::float8*expected) +
       (normal_count*minimum) + jackpot_ticket::float8*jackpot_value)/1000000000000.0;
     if expected>c.price*c.target_return then lo:=alpha;
     else hi:=alpha; end if;
   end loop;
   alpha:=(lo+hi)/2;
   with scores as (
     select r.case_id,r.item,exp(-alpha*ln(i.guide::float8/minimum)) as score
     from rips.case_rewards r join rips.catalog i on i.id=r.item
     where r.case_id=c.id and not r.chase
   ), quotas as (
     select *,normal_tickets::numeric *score/sum(score) over() as quota
     from scores
   ), basis as (
     select *,floor(quota)::bigint as base,
     row_number() over(order by quota-floor(quota) desc,item) as rn
     from quotas
   ), updated as (
     select *, normal_tickets - sum(base) over() as remainder
     from basis
   )
   update rips.case_rewards r
   set weight=1+u.base+case when u.rn<=u.remainder then 1 else 0 end
   from updated u where r.case_id=u.case_id and r.item=u.item;
   update rips.case_rewards set weight=jackpot_ticket
   where case_id=c.id and chase;
   if (select sum(weight) from rips.case_rewards where case_id=c.id)<>1000000000000 then
     raise exception 'Pool for % is not 100%%',c.id;
   end if;
   select sum(i.guide::numeric*r.weight::numeric)/1000000000000 into actual_value
   from rips.case_rewards r join rips.catalog i on i.id=r.item
   where r.case_id=c.id;
   if abs(actual_value/c.price-c.target_return)>0.012 then
      raise exception 'Pack % EV % does not meet target %',c.id,actual_value,c.target_return;
   end if;
   update rips.cases set config_version=config_version+1 where id=c.id;
 end loop;
end $fn$;
revoke all on function rips.rebalance_boss_odds() from public,anon,authenticated;

do $$
declare src text;
begin
 select pg_get_functiondef('rips.command(text,jsonb)'::regprocedure) into src;
 src:=replace(src,'ticket integer; result jsonb;', 'ticket bigint; result jsonb;');
 src:=replace(src,'ticket:=floor(random()*1000000)::integer;',
  'ticket:=floor(random()*(case when chosen.pack=''boss'' then 1000000000000::numeric else 1000000::numeric end))::bigint;');
 if src not like '%ticket bigint; result jsonb;%'
    or src not like '%when chosen.pack=''boss'' then 1000000000000%' then
    raise exception 'Could not safely update server-side draw precision';
 end if;
 execute src;
end $$;
select rips.rebalance_boss_odds();