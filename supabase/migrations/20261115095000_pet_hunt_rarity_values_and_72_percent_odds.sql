-- Pet Hunt 2026-11-15 rarity-based economy.
-- Only server-owned custom Pet Hunt guide values change. Real GE values are untouched.
-- Every prize remains in its current pack; jackpot remains exactly 1 in 1,000,000.
-- Odds are recomputed by a decreasing function of item value to a 72% target return.
-- Historic pulls, balances, inventory instances, sales and purchase snapshots are untouched.
do $pet_economy$
declare
  group_row record;
  pack_row record;
  changed integer;
  k integer;
  minimum double precision;
  lo double precision;
  hi double precision;
  midpoint double precision;
  candidate_ev double precision;
  exponent double precision;
  calculated_return numeric;
  total_tickets constant bigint:=1000000000000;
  jackpot_tickets constant bigint:=1000000;
  jackpot_value constant bigint:=150000000;
begin
  -- Serialize with pack purchases, inventory sales and reward settlement.
  perform pg_advisory_xact_lock(194712855);

  if (select count(*) from rips.catalog where pack='pets')<>85
    or (select count(*) from rips.catalog where pack='pets' and ge_id is null)<>83
    or (select count(*) from rips.cases where pack='pets')<>3
  then raise exception 'Pet Hunt catalog/case configuration changed; abort repricing'; end if;

  -- Within every rarity band, give individual rewards distinct prices.
  -- "premium_common" originally contained two different probability bands
  -- despite identical 5m guides; preserve that distinction in new values.
  for group_row in
    select * from (values
      ('starter_common',   700::bigint,      450::bigint,     100::bigint,  4, 'all'),
      ('starter_uncommon',1750::bigint,     1250::bigint,     300::bigint,  4, 'all'),
      ('select_rare',     4500::bigint,    12000::bigint,    3000::bigint,  3, 'all'),
      ('premium_common',5000000::bigint,3500000::bigint,  500000::bigint,  8, 'high'),
      ('premium_rare',  15000000::bigint,18000000::bigint,500000::bigint,39, 'all'),
      ('premium_uncommon',5000000::bigint,9000000::bigint,500000::bigint, 16, 'low'),
      ('premium_epic',  45000000::bigint,42000000::bigint,5000000::bigint, 8, 'all')
    ) as band(label, old_guide, start_guide, step_guide, expected_count, split_band)
  loop
    with ranked as (
      select c.id,row_number() over (order by c.name,c.id)-1 as ordinal
      from rips.catalog c
      where c.pack='pets' and c.ge_id is null and c.guide=group_row.old_guide
      and (
        group_row.split_band='all'
        or exists(
          select 1 from rips.case_rewards r
          where r.case_id='pets-premium' and r.item=c.id
            and ((group_row.split_band='high' and r.weight>10000000000)
              or (group_row.split_band='low' and r.weight<=10000000000))
        )
      )
    )
    update rips.catalog c
      set guide=group_row.start_guide+group_row.step_guide*ranked.ordinal
    from ranked where c.id=ranked.id;
    get diagnostics changed = row_count;
    if changed<>group_row.expected_count then
      raise exception 'Pet value band % expected % but updated %',group_row.label,group_row.expected_count,changed;
    end if;
  end loop;

  update rips.catalog set guide=jackpot_value
    where id='pets_mr_mcgroot' and pack='pets' and ge_id is null and guide=100000000;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Pet jackpot missing or unexpectedly priced'; end if;

  if (select count(distinct guide) from rips.catalog where pack='pets' and ge_id is null)<>83
    or exists(select 1 from rips.catalog where pack='pets' and guide<=0)
  then raise exception 'All 83 custom pet values must be positive and distinct'; end if;

  for pack_row in select id,price,target_return from rips.cases where pack='pets' order by price
  loop
    if (select count(*) from rips.case_rewards where case_id=pack_row.id and chase)<>1
      or (select count(*) from rips.case_rewards r join rips.catalog c on c.id=r.item
          where r.case_id=pack_row.id and r.chase
            and (c.id<>'pets_mr_mcgroot' or c.guide<>jackpot_value))<>1
    then raise exception 'Pack % jackpot integrity mismatch',pack_row.id; end if;
    if pack_row.target_return<>0.72
    then raise exception 'Pack % target return differs from 72 percent',pack_row.id; end if;

    select min(c.guide::double precision) into minimum
      from rips.case_rewards r join rips.catalog c on c.id=r.item
      where r.case_id=pack_row.id and not r.chase and c.guide>0;
    if minimum is null then raise exception 'Pack % missing non-jackpot rewards',pack_row.id; end if;

    lo:=0;hi:=24;
    for k in 1..100 loop
      midpoint:=(lo+hi)/2;
      select sum(c.guide::double precision*exp(-midpoint*ln(c.guide::double precision/minimum)))/
             sum(exp(-midpoint*ln(c.guide::double precision/minimum)))
        into candidate_ev
      from rips.case_rewards r join rips.catalog c on c.id=r.item
      where r.case_id=pack_row.id and not r.chase;
      candidate_ev:=candidate_ev*(total_tickets-jackpot_tickets)/total_tickets+
        jackpot_value::double precision*jackpot_tickets/total_tickets;
      if candidate_ev>pack_row.price*pack_row.target_return then lo:=midpoint;
      else hi:=midpoint;
      end if;
    end loop;
    exponent:=hi;

    -- Largest-remainder apportionment: all remaining odds tickets are allocated
    -- exactly once with higher-priced pets receiving lower probabilities.
    with scores as (
      select r.item,
        exp(-exponent*ln(c.guide::double precision/minimum))::numeric as score
      from rips.case_rewards r join rips.catalog c on c.id=r.item
      where r.case_id=pack_row.id and not r.chase
    ),
    allocations as (
      select item,
        floor((total_tickets-jackpot_tickets)::numeric*score/sum(score) over())::bigint as whole,
        ((total_tickets-jackpot_tickets)::numeric*score/sum(score) over())-
          floor((total_tickets-jackpot_tickets)::numeric*score/sum(score) over()) as fraction
      from scores
    ),
    ranks as (
      select item,whole,row_number() over (order by fraction desc,item) as position,
        (total_tickets-jackpot_tickets)-sum(whole) over() as leftover
      from allocations
    )
    update rips.case_rewards r
      set weight=ranks.whole+case when ranks.position<=ranks.leftover then 1 else 0 end
      from ranks where r.case_id=pack_row.id and r.item=ranks.item;

    update rips.case_rewards set weight=jackpot_tickets
      where case_id=pack_row.id and chase;

    if (select sum(weight) from rips.case_rewards where case_id=pack_row.id)<>total_tickets
      or exists(select 1 from rips.case_rewards where case_id=pack_row.id and weight<=0)
    then raise exception 'Pack % invalid odds normalization',pack_row.id; end if;

    if exists(
      select 1 from (
        select c.guide,r.weight,
          lag(c.guide) over(order by c.guide,c.id) previous_guide,
          lag(r.weight) over(order by c.guide,c.id) previous_weight
        from rips.case_rewards r join rips.catalog c on c.id=r.item
        where r.case_id=pack_row.id and not r.chase
      ) ranked where ranked.guide>ranked.previous_guide
        and ranked.weight>=ranked.previous_weight
    ) then raise exception 'Pack % rarity must inversely match value',pack_row.id; end if;

    select sum(c.guide::numeric*r.weight)/total_tickets
      into calculated_return
      from rips.case_rewards r join rips.catalog c on c.id=r.item
      where r.case_id=pack_row.id;
    if abs(calculated_return-pack_row.price*pack_row.target_return)>
         greatest(1::numeric,pack_row.price*.0001)
    then raise exception 'Pack % expected payout % does not meet 72 percent target',
         pack_row.id,calculated_return;
    end if;

    update rips.cases set config_version=config_version+1
      where id=pack_row.id;
  end loop;
end
$pet_economy$;