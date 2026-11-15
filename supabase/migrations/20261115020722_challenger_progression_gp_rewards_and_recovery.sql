-- Challenger Rips Step 2: deterministic, server-authorized ways to earn GP.
-- Existing wallet balances, daily 50,000 GP claim, case prices and draw odds remain untouched.
create table if not exists rips.economy_milestone_grants (
  owner uuid not null references rips.players(id) on delete cascade,
  code text not null,
  gp bigint not null check (gp between 1 and 50000),
  claimed_at timestamptz not null default now(),
  primary key (owner,code)
);
create table if not exists rips.economy_recovery_claims (
  owner uuid primary key references rips.players(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  total_claims integer not null default 1 check (total_claims >= 1)
);
alter table rips.economy_milestone_grants enable row level security;
alter table rips.economy_recovery_claims enable row level security;
revoke all on table rips.economy_milestone_grants, rips.economy_recovery_claims from public, anon, authenticated;

create or replace function rips.economy_board(action text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $economy$
declare
  uid uuid := auth.uid();
  balance bigint;
  minimum_price bigint;
  recovery_date timestamptz;
  recovery_blocked boolean;
  available_recovery boolean;
  requested_code text := coalesce(payload->>'code','');
  pack_row record;
  stage_row record;
  collected integer;
  identifier text;
  claimed boolean;
  milestones jsonb := '[]'::jsonb;
  granted text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if action not in ('economy_status','economy_claim','economy_recover') then
    raise exception 'Unsupported economy action.';
  end if;
  if action <> 'economy_status' then
    -- Shares the purchase/settlement lock so simultaneous claims cannot double-credit GP.
    perform pg_advisory_xact_lock(194712855);
  end if;
  select gp into balance from rips.players where id=uid;
  if not found then raise exception 'Create a player first.'; end if;
  select min(price) into minimum_price from rips.cases where price > 0;
  minimum_price := coalesce(minimum_price,1000);
  select claimed_at into recovery_date from rips.economy_recovery_claims where owner=uid;
  select exists (
    select 1 from rips.batches b join rips.batch_rewards r on r.batch=b.id
    where b.owner=uid and r.reward_status='pending'
  ) into recovery_blocked;
  available_recovery :=
    balance < minimum_price and not recovery_blocked and
    (recovery_date is null or recovery_date <= now() - interval '24 hours');

  if action='economy_recover' then
    if balance >= minimum_price then
      raise exception 'Recovery is available only below the cheapest pack price.';
    end if;
    if recovery_blocked then
      raise exception 'Finish your pending pack before requesting recovery.';
    end if;
    if not available_recovery then
      raise exception 'Recovery is on a 24-hour cooldown.';
    end if;
    insert into rips.economy_recovery_claims(owner,claimed_at,total_claims)
      values (uid,now(),1)
      on conflict(owner) do update set
        claimed_at=excluded.claimed_at,
        total_claims=rips.economy_recovery_claims.total_claims+1;
    update rips.players set gp=gp+5000 where id=uid;
    return rips.economy_board('economy_status','{}'::jsonb);
  end if;

  for pack_row in
    select c.pack, count(*)::integer as total
    from rips.catalog c
    where c.pack in ('boss','clue','pets')
    group by c.pack order by c.pack
  loop
    select count(*)::integer into collected
    from rips.pulls p join rips.catalog c on c.id=p.item
    where p.owner=uid and c.pack=pack_row.pack and p.count>0;
    for stage_row in
      select distinct on (goal) stage,label,goal,amount
      from (values
        ('first'::text,'First find'::text,1,2000::bigint),
        ('scout','Scout',greatest(2,ceil(pack_row.total * 0.10)::integer),5000::bigint),
        ('collector','Collector',greatest(3,ceil(pack_row.total * 0.25)::integer),12000::bigint),
        ('veteran','Veteran',greatest(4,ceil(pack_row.total * 0.50)::integer),25000::bigint),
        ('complete','Complete',pack_row.total,50000::bigint)
      ) as v(stage,label,goal,amount)
      where goal <= pack_row.total
      order by goal,amount desc
    loop
      identifier:=pack_row.pack||':'||stage_row.stage;
      select exists(
        select 1 from rips.economy_milestone_grants g
        where g.owner=uid and g.code=identifier
      ) into claimed;
      if action='economy_claim' and requested_code=identifier then
        if collected<stage_row.goal then
          raise exception 'This collection milestone is not complete.';
        end if;
        if claimed then raise exception 'This milestone has already been claimed.'; end if;
        insert into rips.economy_milestone_grants(owner,code,gp)
          values (uid,identifier,stage_row.amount)
          on conflict(owner,code) do nothing returning code into granted;
        if granted is null then raise exception 'This milestone has already been claimed.'; end if;
        update rips.players set gp=gp+stage_row.amount where id=uid;
        return rips.economy_board('economy_status','{}'::jsonb);
      end if;
      milestones:=milestones||jsonb_build_array(jsonb_build_object(
        'code',identifier,'pack',pack_row.pack,'stage',stage_row.stage,
        'title',stage_row.label,'goal',stage_row.goal,'found',collected,
        'total',pack_row.total,'amount',stage_row.amount,'claimed',claimed,
        'available',(not claimed and collected>=stage_row.goal)
      ));
    end loop;
  end loop;
  if action='economy_claim' then raise exception 'Unknown collection milestone.'; end if;
  return jsonb_build_object(
    'gp',balance,'dailyAmount',50000,'minimumPackPrice',minimum_price,
    'recovery',jsonb_build_object(
      'amount',5000,'available',available_recovery,
      'balanceTooHigh',balance>=minimum_price,
      'pendingPack',recovery_blocked,
      'nextAt',case when recovery_date is null then null
        else recovery_date+interval '24 hours' end
    ),
    'milestones',milestones
  );
end $economy$;
revoke all on function rips.economy_board(text,jsonb) from public,anon,authenticated;

-- Add only the new routed actions. Preserve all existing purchase and reward logic.
do $patch$
declare
  definition text;
  anchor text :=
    'if action in (''reward_batch'',''reward_reveal'',''reward_settle'') then return rips.reward_session(action,payload); end if;';
begin
  select pg_get_functiondef('rips.command(text,jsonb)'::regprocedure) into definition;
  if definition like '%rips.economy_board(action,payload)%' then return; end if;
  if position(anchor in definition)=0 then
    raise exception 'Existing command routing changed; manual review required.';
  end if;
  definition:=replace(definition,anchor,anchor||E'\n '||
    'if action in (''economy_status'',''economy_claim'',''economy_recover'') then return rips.economy_board(action,payload); end if;');
  execute definition;
end $patch$;