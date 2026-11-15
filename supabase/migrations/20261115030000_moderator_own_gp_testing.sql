-- Challenger Rips: account-bound moderator test GP controls.
-- Role grants persist by immutable auth user ID, not editable usernames or user_metadata.
-- This migration does not add GP to any wallet and does not modify other players.
create table if not exists rips.moderator_roles(
  owner uuid primary key references rips.players(id) on delete cascade,
  role text not null check(role='moderator'),
  can_add_gp boolean not null default false,
  granted_at timestamptz not null default now()
);
create table if not exists rips.moderator_gp_audit(
  id bigint generated always as identity primary key,
  actor uuid not null references rips.players(id) on delete restrict,
  request_id uuid not null,
  amount bigint not null check(amount>0 and amount<=1000000000),
  balance_before bigint not null check(balance_before>=0),
  balance_after bigint not null check(balance_after>=balance_before),
  created_at timestamptz not null default now(),
  unique(actor,request_id)
);
create index if not exists moderator_gp_audit_actor_idx on rips.moderator_gp_audit(actor,created_at desc);
alter table rips.moderator_roles enable row level security;
alter table rips.moderator_gp_audit enable row level security;
revoke all on rips.moderator_roles,rips.moderator_gp_audit from public,anon,authenticated;

do $role$
declare n int;
begin
  select count(*) into n from rips.players p join auth.users u on u.id=p.id
  where lower(p.name)='zeuxidamus';
  if n<>1 then raise exception 'Moderator grant requires exactly one verified zeuxidamus account (found %)',n; end if;
  insert into rips.moderator_roles(owner,role,can_add_gp)
  select p.id,'moderator',true from rips.players p join auth.users u on u.id=p.id
  where lower(p.name)='zeuxidamus'
  on conflict(owner) do update set role='moderator',can_add_gp=true;
end $role$;

create or replace function rips.moderator_tool(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $mod$
declare
  uid uuid:=auth.uid();
  authorized boolean:=false;
  increment bigint;
  old_gp bigint;
  new_gp bigint;
  request uuid;
  recorded rips.moderator_gp_audit%rowtype;
  history jsonb;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  select coalesce(bool_or(role='moderator' and can_add_gp),false)
    into authorized from rips.moderator_roles where owner=uid;
  if action='moderator_status' then
    if not authorized then
      return jsonb_build_object('isModerator',false,'canAddGp',false);
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('amount',recent.amount,
      'balanceAfter',recent.balance_after,'createdAt',recent.created_at)
      order by recent.created_at desc),'[]'::jsonb)
    into history from (select amount,balance_after,created_at from rips.moderator_gp_audit
      where actor=uid order by created_at desc,id desc limit 8) recent;
    return jsonb_build_object('isModerator',true,'role','moderator',
      'canAddGp',true,'maxPerGrant',1000000000,
      'history',history);
  end if;
  if action<>'moderator_gp_add' then raise exception 'Unknown moderator action.'; end if;
  if not authorized then raise exception 'Moderator access required.'; end if;
  if payload is null or jsonb_typeof(payload)<>'object' or
     payload ? 'target' or payload ? 'user_id' or payload ? 'owner' then
    raise exception 'You can only adjust your own balance.'; end if;
  if jsonb_typeof(payload->'amount') is distinct from 'number' or
     (payload->>'amount') !~ '^[1-9][0-9]{0,9}$' then
    raise exception 'Enter a whole-number amount from 1 to 1,000,000,000 GP.'; end if;
  increment:=(payload->>'amount')::bigint;
  if increment not between 1 and 1000000000 then
    raise exception 'Enter a whole-number amount from 1 to 1,000,000,000 GP.'; end if;
  if payload->>'request' is null then raise exception 'Missing adjustment request ID.'; end if;
  request:=(payload->>'request')::uuid;
  perform pg_advisory_xact_lock(194712855);
  select * into recorded from rips.moderator_gp_audit
    where actor=uid and request_id=request;
  if found then
    if recorded.amount<>increment then raise exception 'Adjustment request already used with another amount.'; end if;
    return jsonb_build_object('applied',false,'amount',recorded.amount,
      'newBalance',recorded.balance_after,'alreadyProcessed',true);
  end if;
  select gp into old_gp from rips.players where id=uid for update;
  if old_gp is null then raise exception 'Player account not found.'; end if;
  if old_gp>9000000000000-increment then
    raise exception 'This amount would exceed the maximum GP wallet balance.'; end if;
  new_gp:=old_gp+increment;
  update rips.players set gp=new_gp where id=uid;
  insert into rips.moderator_gp_audit(actor,request_id,amount,balance_before,balance_after)
    values(uid,request,increment,old_gp,new_gp);
  return jsonb_build_object('applied',true,'amount',increment,
    'previousBalance',old_gp,'newBalance',new_gp);
end $mod$;
revoke all on function rips.moderator_tool(text,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION rips.command(action text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 uid uuid:=auth.uid(); batch_id uuid; previous rips.batches; chosen rips.cases;
 qty integer; slot_no integer; reward text; instance_id uuid; ticket bigint; result jsonb; balance bigint;
begin
 if uid is null then raise exception 'Sign in first.'; end if;
 if action in ('moderator_status','moderator_gp_add') then
   return rips.moderator_tool(action,payload);
 end if;
 if action in ('mission_status','mission_claim') then return rips.missions_board(action,payload); end if;
 if action in ('reward_batch','reward_reveal','reward_settle') then return rips.reward_session(action,payload); end if;
 if action in ('economy_status','economy_claim','economy_recover') then return rips.economy_board(action,payload); end if;
 if action='open' then raise exception 'Refresh the page to open a case.'; end if;
 if action='cases' then
   return (select jsonb_agg(jsonb_build_object('id',c.id,'pack',c.pack,'name',c.name,'price',c.price,'theme',c.theme,'accent',c.accent,'symbol',c.symbol,'description',c.description,'targetReturn',c.target_return,'configVersion',c.config_version,
     'rewards',(select jsonb_agg(jsonb_build_object('id',r.item,'weight',r.weight,'chase',r.chase) order by r.chase,i.guide,r.item)
     from rips.case_rewards r join rips.catalog i on i.id=r.item where r.case_id=c.id)) order by c.price,c.id) from rips.cases c);
 end if;
 if action not in ('case_purchase','case_reveal','case_batch') then return rips.economy_command(action,payload); end if;
 if action='case_purchase' then
   perform pg_advisory_xact_lock(194712855);
   batch_id:=(payload->>'request')::uuid;
   qty:=(payload->>'quantity')::integer;
   if batch_id is null or qty is null or qty not between 1 and 5 then raise exception 'Choose 1 to 5 packs.'; end if;
   select * into chosen from rips.cases where id=payload->>'case';
   if not found then raise exception 'Unknown case.'; end if;
   select * into previous from rips.batches where id=batch_id;
   if found then
     if previous.owner<>uid or previous.quantity<>qty or previous.case_id<>chosen.id then raise exception 'Invalid purchase request.'; end if;
   else
     if exists(select 1 from rips.batches b join rips.batch_rewards r on r.batch=b.id where b.owner=uid and r.reward_status='pending') then
       raise exception 'Reveal your current batch first.';
     end if;
     perform rips.economy_command('state','{}');
     select gp into balance from rips.players where id=uid;
     if balance<chosen.price*qty then raise exception 'You need more GP.'; end if;
     update rips.players set gp=gp-chosen.price*qty where id=uid;
     insert into rips.batches(id,owner,case_id,quantity,paid) values(batch_id,uid,chosen.id,qty,chosen.price*qty);
     for slot_no in 1..qty loop
       ticket:=floor(random()*1000000000000::numeric)::bigint;
       select item into strict reward from (
         select item,sum(weight) over(order by item) cutoff from rips.case_rewards where case_id=chosen.id
       ) r where cutoff>ticket order by cutoff limit 1;
       insert into rips.batch_rewards(batch,slot,item) values(batch_id,slot_no,reward);
       insert into rips.items(owner,item,origin) values(uid,reward,uid) returning id into instance_id;
      update rips.batch_rewards set instance=instance_id where batch=batch_id and slot=slot_no;
       insert into rips.pulls(owner,item) values(uid,reward)
       on conflict(owner,item) do update set count=rips.pulls.count+1;
     end loop;
   end if;
 elsif action='case_reveal' then
   batch_id:=(payload->>'batch')::uuid;
   slot_no:=(payload->>'slot')::integer;
   update rips.batch_rewards r set revealed=true from rips.batches b
   where b.id=r.batch and b.owner=uid and b.id=batch_id and (slot_no is null or r.slot=slot_no);
 else
   select b.id into batch_id from rips.batches b where b.owner=uid
   and exists(select 1 from rips.batch_rewards r where r.batch=b.id and not r.revealed)
   order by b.created desc limit 1;
 end if;
 select jsonb_build_object('id',b.id,'case',b.case_id,'paid',b.paid,'rewards',
 (select jsonb_agg(jsonb_build_object('slot',r.slot,'item',case when r.revealed then r.item end,'instance',case when r.revealed then r.instance end) order by r.slot)
 from rips.batch_rewards r where r.batch=b.id))
 into result from rips.batches b where b.id=batch_id and b.owner=uid;
 return result;
end $function$;
