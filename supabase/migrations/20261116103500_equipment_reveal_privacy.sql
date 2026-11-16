-- Never count rewards that were drawn but have not been revealed. Historical
-- rips.pulls.count remains trustworthy after subtracting pending, unrevealed copies.
-- This prevents Equipment Sets and legendary badges from leaking hidden rewards.
CREATE OR REPLACE FUNCTION rips.equipment_sets_state(uid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with pieces as (
select p.set_id,p.ge_id,p.slot,p.position,
  (select c.name from rips.catalog c where c.ge_id=p.ge_id order by c.id limit 1) name,
  exists(select 1 from rips.pulls pl join rips.catalog c on c.id=pl.item
     where pl.owner=uid and c.ge_id=p.ge_id and pl.count>(
       select count(*) from rips.batch_rewards hidden
       join rips.batches parent_batch on parent_batch.id=hidden.batch
       where parent_batch.owner=uid and hidden.item=pl.item
         and hidden.reward_status='pending' and not hidden.revealed
     )) as discovered,
  exists(select 1 from rips.items i join rips.catalog c on c.id=i.item
     where i.owner=uid and c.ge_id=p.ge_id
       and not exists(select 1 from rips.batch_rewards br
           where br.instance=i.id and br.reward_status='pending')) as owned,
  exists(select 1 from rips.equipment_slots e join rips.items i on i.id=e.instance
     join rips.catalog c on c.id=i.item
     where e.owner=uid and c.ge_id=p.ge_id and e.slot=p.slot) as equipped,
  (select i.id from rips.items i join rips.catalog c on c.id=i.item
     where i.owner=uid and c.ge_id=p.ge_id
     and not exists(select 1 from rips.batch_rewards br
        where br.instance=i.id and br.reward_status='pending')
     order by i.acquired,i.id limit 1) as instance,
  coalesce((
   select jsonb_agg(jsonb_build_object(
     'case',cs.id,'name',cs.name,'pack',cs.pack,'price',cs.price,
     'chance',r.weight::numeric/(select sum(weights.weight) from rips.case_rewards weights
       where weights.case_id=cs.id)) order by cs.price,cs.name)
   from rips.catalog c join rips.case_rewards r on r.item=c.id
   join rips.cases cs on cs.id=r.case_id
   where c.ge_id=p.ge_id and r.weight>0
  ),'[]'::jsonb) sources
from rips.equipment_set_pieces p
), grouped as (
 select p.set_id,count(*) total,
 count(*) filter(where discovered) discovered_count,
 count(*) filter(where owned) owned_count,
 count(*) filter(where equipped) equipped_count,
 jsonb_agg(jsonb_build_object(
  'geId',p.ge_id,'slot',p.slot,'name',p.name,'discovered',p.discovered,
  'owned',p.owned,'equipped',p.equipped,'instance',p.instance,'sources',p.sources)
  order by p.position) as pieces
 from pieces p group by p.set_id
)
select coalesce(jsonb_agg(jsonb_build_object(
 'id',s.id,'name',s.name,'tier',s.tier,'description',s.description,
 'required',g.total,'discovered',g.discovered_count,'owned',g.owned_count,
 'equipped',g.equipped_count,'pieces',g.pieces,
 'completed',g.owned_count=g.total,'historicalComplete',g.discovered_count=g.total,
 'fullyEquipped',g.equipped_count=g.total
) order by case s.tier when 'starter' then 1 when 'intermediate' then 2
 when 'advanced' then 3 else 4 end,s.name),'[]'::jsonb)
from rips.equipment_sets s join grouped g on g.set_id=s.id
$function$;

CREATE OR REPLACE FUNCTION rips.equipment_award(uid uuid, sets jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare piece jsonb; completions integer:=0;
begin
 for piece in select value from jsonb_array_elements(sets) loop
   if (piece->>'completed')::boolean or (piece->>'historicalComplete')::boolean then
     completions:=completions+1;
     insert into rips.equipment_achievements(owner,code)
       values(uid,piece->>'id') on conflict do nothing;
   end if;
 end loop;
 if exists(select 1 from rips.equipment_slots where owner=uid) then
   insert into rips.equipment_achievements(owner,code) values(uid,'first_equip')
   on conflict do nothing;
 end if;
 if completions>=1 then
   insert into rips.equipment_achievements(owner,code) values(uid,'first_set')
   on conflict do nothing;
 end if;
 if completions>=3 then
   insert into rips.equipment_achievements(owner,code) values(uid,'three_sets')
   on conflict do nothing;
 end if;
 if exists(select 1 from jsonb_array_elements(sets) v
   where (v->>'fullyEquipped')::boolean) then
   insert into rips.equipment_achievements(owner,code) values(uid,'full_equipped')
   on conflict do nothing;
 end if;
 if exists(
   select 1 from rips.pulls pl join rips.catalog c on c.id=pl.item
   where pl.owner=uid and c.name ilike '3rd Age%' and pl.count>(
       select count(*) from rips.batch_rewards hidden
       join rips.batches parent_batch on parent_batch.id=hidden.batch
       where parent_batch.owner=uid and hidden.item=pl.item
         and hidden.reward_status='pending' and not hidden.revealed
     )
 ) then
   insert into rips.equipment_achievements(owner,code)
     values(uid,'legendary_piece') on conflict do nothing;
 end if;
end $function$;
