-- Challenger Rips daily and weekly missions, server authoritative. Existing records remain intact.
create table if not exists rips.mission_definitions(
 id text primary key,
 cadence text not null check(cadence in('daily','weekly')),
 title text not null,
 description text not null default '',
 metric text not null check(metric in('packs','discovery','sales')),
 goal integer not null check(goal between 1 and 1000),
 reward bigint not null check(reward between 1 and 10000000),
 sort_order integer not null default 0,
 enabled boolean not null default true
);
create table if not exists rips.mission_claims(
 owner uuid not null references rips.players(id) on delete cascade,
 mission_id text not null references rips.mission_definitions(id),
 period_start timestamptz not null,
 reward bigint not null check(reward>0),
 claimed_at timestamptz not null default now(),
 primary key(owner,mission_id,period_start)
);
alter table rips.mission_definitions enable row level security;
alter table rips.mission_claims enable row level security;
revoke all on rips.mission_definitions,rips.mission_claims from public,anon,authenticated;
create index if not exists mission_claims_owner_idx on rips.mission_claims(owner,claimed_at desc);
create index if not exists mission_batches_owner_idx on rips.batches(owner,created desc);
create index if not exists mission_pulls_owner_idx on rips.pulls(owner,first desc);

insert into rips.mission_definitions(id,cadence,title,description,metric,goal,reward,sort_order,enabled)
values
('daily_open_3','daily','Open 3 packs','Open any three mystery packs.','packs',3,2000,1,true),
('daily_discover_2','daily','Discover 2 new items','Find two items you have never collected before.','discovery',2,4000,2,true),
('daily_sell_3','daily','Sell 3 items','Sell three items through the GE or player market.','sales',3,3000,3,true),
('weekly_open_25','weekly','Open 25 packs','Open 25 mystery packs this week.','packs',25,25000,1,true),
('weekly_discover_8','weekly','Discover 8 new items','Add eight never-before-collected items to your collection.','discovery',8,30000,2,true),
('weekly_sell_15','weekly','Sell 15 items','Sell fifteen items through the GE or player market.','sales',15,18000,3,true)
on conflict(id) do nothing;

create or replace function rips.missions_board(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $mission$
declare
 uid uuid:=auth.uid();
 stamp timestamptz:=now();
 day_start timestamptz:=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 week_start timestamptz:=date_trunc('week',now() at time zone 'UTC') at time zone 'UTC';
 window_start timestamptz;
 window_end timestamptz;
 mission rips.mission_definitions;
 progress_count bigint;
 was_claimed boolean;
 selected_id text;
 result_daily jsonb:='[]'::jsonb;
 result_weekly jsonb:='[]'::jsonb;
 entry jsonb;
 claimed_amount bigint:=0;
 player_gp bigint;
begin
 if uid is null then raise exception 'Sign in first.'; end if;
 if action not in('mission_status','mission_claim') then raise exception 'Unsupported mission action.'; end if;
 if action='mission_claim' then
   perform pg_advisory_xact_lock(194712855);
   select gp into player_gp from rips.players where id=uid for update;
   if player_gp is null then raise exception 'Create a player account first.'; end if;
   selected_id:=payload->>'id';
   if selected_id is null or char_length(selected_id)>80 then
     raise exception 'Choose a mission to claim.'; end if;
 end if;
 for mission in select * from rips.mission_definitions where enabled
   order by case cadence when 'daily' then 0 else 1 end,sort_order,id loop
   window_start:=case when mission.cadence='daily' then day_start else week_start end;
   window_end:=window_start+case when mission.cadence='daily' then interval '1 day' else interval '7 days' end;
   if mission.metric='packs' then
     select coalesce(sum(b.quantity),0) into progress_count
     from rips.batches b where b.owner=uid and b.created>=window_start and b.created<window_end;
   elsif mission.metric='discovery' then
     select count(*) into progress_count from rips.pulls p
     where p.owner=uid and p.first>=window_start and p.first<window_end;
   elsif mission.metric='sales' then
     select count(*) into progress_count from rips.sales s
     where s.seller=uid and s.sold>=window_start and s.sold<window_end;
   end if;
   select exists(select 1 from rips.mission_claims c
     where c.owner=uid and c.mission_id=mission.id and c.period_start=window_start) into was_claimed;
   if action='mission_claim' and mission.id=selected_id then
     if was_claimed then raise exception 'This mission reward was already claimed.'; end if;
     if progress_count<mission.goal then raise exception 'This mission is not complete yet.'; end if;
     update rips.players set gp=gp+mission.reward
       where id=uid and gp<=9000000000000-mission.reward;
     if not found then raise exception 'Your GP wallet cannot hold this reward.'; end if;
     insert into rips.mission_claims(owner,mission_id,period_start,reward)
       values(uid,mission.id,window_start,mission.reward);
     claimed_amount:=mission.reward;
     was_claimed:=true;
   end if;
   entry:=jsonb_build_object('id',mission.id,'title',mission.title,'description',mission.description,
     'cadence',mission.cadence,'metric',mission.metric,'goal',mission.goal,
     'progress',least(progress_count,mission.goal),'reward',mission.reward,
     'claimed',was_claimed,'available',progress_count>=mission.goal and not was_claimed,
     'sort',mission.sort_order);
   if mission.cadence='daily' then result_daily:=result_daily||jsonb_build_array(entry);
   else result_weekly:=result_weekly||jsonb_build_array(entry); end if;
 end loop;
 if action='mission_claim' and claimed_amount=0 then raise exception 'Mission not found.'; end if;
 return jsonb_build_object('serverTime',stamp,
   'dailyResetAt',day_start+interval '1 day','weeklyResetAt',week_start+interval '7 days',
   'daily',result_daily,'weekly',result_weekly,'claimedAmount',claimed_amount);
end $mission$;
revoke all on function rips.missions_board(text,jsonb) from public,anon,authenticated;

-- Attribute each newly verified sale to its actual seller, including player-to-player trading.
do $patch$
declare src text;
begin
 select pg_get_functiondef('rips.economy_command(text,jsonb)'::regprocedure) into src;
 src:=replace(src,'insert into rips.sales(item,price) values(asset.item,amount);',
    'insert into rips.sales(item,price,seller) values(asset.item,amount,uid);');
 src:=replace(src,'insert into rips.sales(item,price) values(asset.item,listing.price);',
    'insert into rips.sales(item,price,seller) values(asset.item,listing.price,asset.owner);');
 if src not like '%values(asset.item,amount,uid)%'
    or src not like '%values(asset.item,listing.price,asset.owner)%'
    then raise exception 'Sale attribution failed for economy_command.'; end if;
 execute src;
 select pg_get_functiondef('rips.sell_inventory_bulk(jsonb)'::regprocedure) into src;
 src:=replace(src,'insert into rips.sales(item,price)
  select i.item,c.guide',
   'insert into rips.sales(item,price,seller)
  select i.item,c.guide,uid');
 if src not like '%insert into rips.sales(item,price,seller)%'
    then raise exception 'Sale attribution failed for bulk sells.';end if;
 execute src;
 select pg_get_functiondef('rips.reward_session(text,jsonb)'::regprocedure) into src;
 src:=replace(src,'insert into rips.sales(item,price) values(row_record.item,row_record.guide);',
   'insert into rips.sales(item,price,seller) values(row_record.item,row_record.guide,uid);');
 if src not like '%values(row_record.item,row_record.guide,uid)%'
    then raise exception 'Sale attribution failed for reward sells.';end if;
 execute src;
 select pg_get_functiondef('rips.command(text,jsonb)'::regprocedure) into src;
 src:=replace(src,
  'if action in (''reward_batch'',''reward_reveal'',''reward_settle'') then',
  'if action in (''mission_status'',''mission_claim'') then return rips.missions_board(action,payload); end if;
 if action in (''reward_batch'',''reward_reveal'',''reward_settle'') then');
 if src not like '%return rips.missions_board(action,payload)%'
    then raise exception 'Mission RPC route patch failed.';end if;
 execute src;
end $patch$;