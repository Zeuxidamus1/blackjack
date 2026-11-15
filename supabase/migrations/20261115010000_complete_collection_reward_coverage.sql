-- Collection Log coverage repair (2026-11-15)
-- All existing catalog entries must be obtainable from an existing pack.
-- No catalog rows, player wallets, purchases, inventories or reward sessions are deleted.
-- Clue/Pet historic 1m-ticket weights are scaled to 1 trillion tickets before new items are added;
-- existing odds retain 98% of their prior share in cases with newly assigned rewards.
-- Boss Loot retains its 1 trillion tickets and recomputes its normal rewards through the
-- existing rips.rebalance_boss_odds() 72% target-return algorithm.
do $coverage$
declare
  old_command text;
  changed_command text;
  current_ratio numeric;
  previous_ratio numeric;
  case_rec record;
begin
  perform pg_advisory_xact_lock(194712855);

  create temporary table pg_temp.reward_coverage_candidates on commit drop as
  select c.id as item,c.pack,c.guide,
    case
      when c.pack='boss' and c.guide<=1000 then 'boss-starter'
      when c.pack='boss' then 'boss-god'
      when c.pack='clue' and c.guide<=1000 then 'clue-starter'
      when c.pack='clue' and c.guide<=25000 then 'clue-select'
      when c.pack='clue' then 'clue-premium'
      when c.pack='pets' and c.guide<=1000 then 'pets-starter'
      when c.pack='pets' then 'pets-premium'
      else null
    end as case_id
  from rips.catalog c
  where not exists(select 1 from rips.case_rewards r where r.item=c.id and r.weight>0);

  if not exists(select 1 from pg_temp.reward_coverage_candidates) then
    raise exception 'There are no uncovered items. The coverage migration has already been applied.';
  end if;
  if exists(select 1 from pg_temp.reward_coverage_candidates where case_id is null or guide is null or guide<=0) then
    raise exception 'Unassigned or invalid catalog values require review before changing odds.';
  end if;

  create temporary table pg_temp.reward_coverage_baseline on commit drop as
  select c.id,c.pack,c.price,c.target_return,
    (sum(r.weight::numeric*i.guide::numeric)/sum(r.weight)::numeric)/c.price::numeric as return_ratio
  from rips.cases c join rips.case_rewards r on r.case_id=c.id
  join rips.catalog i on i.id=r.item
  group by c.id,c.pack,c.price,c.target_return;

  -- 1m -> 1 trillion ticket precision. Existing rewards in cases receiving new
  -- catalog entries retain 98% of their exact previous probabilities.
  update rips.case_rewards r set weight=r.weight *
    case when exists(select 1 from pg_temp.reward_coverage_candidates m where m.case_id=r.case_id)
      then 980000::bigint else 1000000::bigint end
  from rips.cases c
  where c.id=r.case_id and c.pack in ('clue','pets');

  -- New Boss Loot rewards use the existing economic rebalancer rather than
  -- arbitrary manual odds that could alter the expected GP return.
  insert into rips.case_rewards(case_id,item,weight,chase)
  select case_id,item,1::bigint,false
  from pg_temp.reward_coverage_candidates where pack='boss';

  -- Allocate 2% of tickets across newly eligible clue and pet rewards, with
  -- cheaper items more likely. The 10,000-ticket floor gives even very rare
  -- grails a nonzero, displayable probability (0.000001% minimum).
  with prepared as (
    select m.*,count(*) over(partition by case_id) as n,
      min(greatest(guide,1)) over(partition by case_id) as min_guide
    from pg_temp.reward_coverage_candidates m where pack in('clue','pets')
  ), scores as (
    select *,power(greatest(guide,1)::float8/min_guide::float8,-1.75) score from prepared
  ), quotas as (
    select *,((20000000000::numeric-n*10000::numeric)*score/
      sum(score) over(partition by case_id)) as quota from scores
  ), floors as (
    select *,floor(quota)::bigint base,
      row_number() over(partition by case_id order by quota-floor(quota) desc,item) rn
    from quotas
  ), rounded as (
    select *,sum(base) over(partition by case_id) as base_sum from floors
  )
  insert into rips.case_rewards(case_id,item,weight,chase)
  select case_id,item,
    10000::bigint+base+
      case when rn<=20000000000::numeric-n*10000::numeric-base_sum then 1 else 0 end,
    case when pack='clue' and guide>=
      (select c.price*10 from rips.cases c where c.id=case_id)
      then true else false end
  from rounded;

  -- Keep Boss jackpots and target returns governed by the original algorithm.
  perform rips.rebalance_boss_odds();

  -- The draw interval must match the same 1-trillion-ticket denominator for
  -- every pack; otherwise high-ticket new rewards could never be drawn.
  select pg_get_functiondef('rips.command(text,jsonb)'::regprocedure) into old_command;
  changed_command:=replace(old_command,
    'floor(random()*(case when chosen.pack=''boss'' then 1000000000000::numeric else 1000000::numeric end))::bigint',
    'floor(random()*1000000000000::numeric)::bigint');
  if changed_command=old_command then
    raise exception 'Could not locate the existing pack-specific draw denominator.';
  end if;
  execute changed_command;

  update rips.cases set config_version=config_version+1 where pack in('clue','pets');

  if exists (
    select 1 from rips.cases c left join rips.case_rewards r on r.case_id=c.id
    group by c.id having coalesce(sum(r.weight),0)<>1000000000000::numeric
  ) then raise exception 'A pack does not have exactly one trillion draw tickets.'; end if;

  if exists (
    select 1 from rips.catalog i where not exists
      (select 1 from rips.case_rewards r where r.item=i.id and r.weight>0)
  ) then raise exception 'At least one catalog item is still unobtainable.'; end if;

  for case_rec in select id,pack,price,target_return from rips.cases loop
    select sum(r.weight::numeric * i.guide::numeric)/
      sum(r.weight)::numeric/case_rec.price::numeric
      into current_ratio
    from rips.case_rewards r join rips.catalog i on i.id=r.item
    where r.case_id=case_rec.id;
    select return_ratio into previous_ratio
      from pg_temp.reward_coverage_baseline where id=case_rec.id;

    if case_rec.pack='boss' and abs(current_ratio-case_rec.target_return)>.012 then
      raise exception 'Boss Loot EV check failed for % (ratio: %)',case_rec.id,current_ratio;
    elsif case_rec.pack<>'boss' and abs(current_ratio-previous_ratio)>.05 then
      raise exception 'Existing pack economy changed excessively for % (% -> %)',
        case_rec.id,previous_ratio,current_ratio;
    end if;
  end loop;
end
$coverage$;
