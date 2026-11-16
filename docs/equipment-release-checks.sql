-- Challenger Rips equipment deployment read-only verification.
-- Run from Supabase SQL editor. Player identifiers are not returned.
-- Catalog and source availability: every launch set piece must be obtainable.
select s.id as equipment_set, s.tier, count(*) as required_pieces,
       count(*) filter(where exists(
         select 1 from rips.equipment_definitions d
         where d.ge_id=p.ge_id and d.slot=p.slot
       )) as equip_metadata_present,
       count(*) filter(where exists(
         select 1 from rips.case_rewards r join rips.catalog c on c.id=r.item
         where c.ge_id=p.ge_id and r.weight>0
       )) as obtainable_pieces
from rips.equipment_sets s
join rips.equipment_set_pieces p on p.set_id=s.id
group by s.id,s.tier order by s.tier,s.id;

-- How much of the current catalog has an equipment classification?
select count(*) as catalog_items,
 count(*) filter(where d.item is not null) as classified_equipment,
 count(*) filter(where d.item is null) as unclassified_non_equipment_or_review_needed,
 count(*) filter(where not exists(select 1 from rips.case_rewards r
      where r.item=c.id and r.weight>0)) as unavailable_items
from rips.catalog c left join rips.equipment_definitions d on d.item=c.id;

-- Owner-verified equipment state and persistent goal/badge counts.
select (select count(*) from rips.equipment_slots) as currently_equipped,
 (select count(distinct owner) from rips.equipment_slots) as active_equipment_players,
 (select count(*) from rips.equipment_goals) as pinned_equipment_goals,
 (select count(*) from rips.equipment_achievements) as permanent_badges,
 (select count(*) from rips.equipment_profiles where share_gear) as gear_sharing_opt_ins,
 (select count(*) from rips.equipment_profiles where share_badges) as badge_sharing_opt_ins;

-- Aggregate usage, no account IDs disclosed.
select event,count(*) as total_events,count(distinct owner) as distinct_players
from rips.equipment_events group by event order by total_events desc;

-- Overall equipment achievements by kind.
select a.code,b.title,count(*) as unlocks
from rips.equipment_achievements a
join rips.equipment_badges b on b.code=a.code
group by a.code,b.title order by unlocks desc,b.title;

-- Show no equipped assets are simultaneously listed or unresolved.
select
 (select count(*) from rips.equipment_slots e join rips.listings l
    on l.instance=e.instance) as equipped_and_listed,
 (select count(*) from rips.equipment_slots e join rips.batch_rewards r
    on r.instance=e.instance where r.reward_status='pending') as equipped_but_pending,
 (select count(*) from rips.equipment_slots e join rips.items i
    on i.id=e.instance where e.owner<>i.owner) as owner_mismatch;

-- Check no browser role can bypass the RPC's protected write model.
select has_function_privilege('anon','public.rips_equipment_command(text,jsonb)','execute')
  as anonymous_equipment_access,
 has_function_privilege('authenticated','public.rips_equipment_command(text,jsonb)','execute')
  as signed_in_equipment_access,
 has_table_privilege('authenticated','rips.equipment_slots','INSERT')
  as signed_in_direct_slot_insert;
