-- Premium reward review: one sealed pack -> one persistent, settled or pending reward.
-- New purchases are pending; previously revealed historical pulls remain already vaulted.
alter table rips.batch_rewards
  add column if not exists reward_status text not null default 'pending',
  add column if not exists resolved_at timestamptz,
  add column if not exists settled_value bigint;
alter table rips.batch_rewards
  add constraint batch_rewards_reward_status_check
  check (reward_status in ('pending','vaulted','sold'));
update rips.batch_rewards set reward_status='vaulted',resolved_at=now()
where revealed and reward_status='pending';

-- The helper is inaccessible from the Data API; authenticated access goes
-- exclusively through the existing public.rips_command wrapper and rips.command.
create or replace function rips.reward_session(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
 uid uuid:=auth.uid();
 requested_batch uuid;
 chosen_batch rips.batches;
 slot_number integer;
 target_action text;
 slot_total integer;
 unique_slots integer;
 matched integer;
 already_done integer;
 chosen_slots integer[];
 row_record record;
 payout bigint:=0;
begin
 if uid is null then raise exception 'Sign in first.'; end if;
 if action not in ('reward_batch','reward_reveal','reward_settle')
 then raise exception 'Unsupported reward action.'; end if;

 if action='reward_batch' and not(payload ? 'batch') then
   select b.id into requested_batch
   from rips.batches b
   where b.owner=uid and exists (
     select 1 from rips.batch_rewards r
     where r.batch=b.id and r.reward_status='pending')
   order by b.created desc,b.id desc limit 1;
 else
   requested_batch:=nullif(payload->>'batch','')::uuid;
 end if;
 if requested_batch is null then return null; end if;

 if action <> 'reward_batch' then
   perform pg_advisory_xact_lock(194712855);
 end if;
 select * into chosen_batch from rips.batches
 where id=requested_batch and owner=uid
 for update;
 if not found then raise exception 'Reward session does not belong to this player.'; end if;

 if action='reward_reveal' then
   if payload ? 'slot' and payload->>'slot' is not null then
     slot_number:=(payload->>'slot')::integer;
     if not exists(select 1 from rips.batch_rewards where batch=requested_batch
       and slot=slot_number and reward_status='pending')
     then raise exception 'This reward is no longer available to reveal.'; end if;
     update rips.batch_rewards set revealed=true where batch=requested_batch
       and slot=slot_number and reward_status='pending';
   else
     update rips.batch_rewards set revealed=true where batch=requested_batch
       and reward_status='pending';
   end if;

 elsif action='reward_settle' then
   target_action:=payload->>'decision';
   if target_action not in ('sell','vault') or target_action is null
   then raise exception 'Choose Sell or Vault.'; end if;
   if jsonb_typeof(payload->'slots') <> 'array'
   then raise exception 'Choose rewards to manage.'; end if;
   select count(*),count(distinct v.value::integer),array_agg(v.value::integer)
   into slot_total,unique_slots,chosen_slots
   from jsonb_array_elements_text(payload->'slots') v(value);
   if slot_total not between 1 and 5 or unique_slots<>slot_total
      or exists(select 1 from unnest(chosen_slots) n where n not between 1 and 5)
   then raise exception 'Select 1 to 5 distinct valid rewards.'; end if;

   select count(*) into matched
   from rips.batch_rewards r
   where r.batch=requested_batch and r.slot=any(chosen_slots)
     and r.revealed and r.reward_status='pending';
   if matched<>slot_total then
     select count(*) into already_done from rips.batch_rewards r
     where r.batch=requested_batch and r.slot=any(chosen_slots)
       and r.revealed and r.reward_status=
         case when target_action='sell' then 'sold' else 'vaulted' end;
     if already_done<>slot_total then
       raise exception 'One or more rewards were already handled. Refresh the results.';
     end if;
   else
     for row_record in
       select r.slot,r.instance,r.item,c.ge_id,c.guide,c.guide_time
       from rips.batch_rewards r
       join rips.catalog c on c.id=r.item
       where r.batch=requested_batch and r.slot=any(chosen_slots)
       order by r.slot for update of r
     loop
       if row_record.instance is null then
         raise exception 'Reward ownership link unavailable. Vault this item instead.';
       end if;
       perform 1 from rips.items i where i.id=row_record.instance and i.owner=uid
         and i.item=row_record.item for update;
       if not found then raise exception 'A reward is no longer in your inventory.'; end if;
       if exists(select 1 from rips.listings l where l.instance=row_record.instance) then
         raise exception 'Cancel your market listing before managing this reward.'; end if;

       if target_action='sell' then
         if row_record.ge_id is null or row_record.guide<1
            or row_record.guide_time is null
            or row_record.guide_time<now()-interval '24 hours'
         then raise exception 'Current Grand Exchange quote unavailable. Try again after refresh.'; end if;
         update rips.batch_rewards set reward_status='sold',
           resolved_at=now(),settled_value=row_record.guide
         where batch=requested_batch and slot=row_record.slot;
         delete from rips.items where id=row_record.instance and owner=uid;
         insert into rips.sales(item,price) values(row_record.item,row_record.guide);
         payout:=payout+row_record.guide;
       else
         update rips.batch_rewards set reward_status='vaulted',
           resolved_at=now(),settled_value=null
         where batch=requested_batch and slot=row_record.slot;
       end if;
     end loop;
     if payout>0 then
       update rips.players set gp=gp+payout where id=uid;
     end if;
   end if;
 end if;

 return (
   select jsonb_build_object(
    'id',b.id,'case',b.case_id,'quantity',b.quantity,'paid',b.paid,
    'remaining',(select count(*) from rips.batch_rewards r
                 where r.batch=b.id and r.reward_status='pending'),
    'rewards',coalesce((
      select jsonb_agg(jsonb_build_object(
        'slot',r.slot,
        'revealed',r.revealed,
        'item',case when r.revealed then r.item end,
        'instance',case when r.revealed and r.reward_status='pending' then r.instance end,
        'status',r.reward_status,
        'value',case when r.revealed then coalesce(r.settled_value,c.guide) end,
        'priceUpdated',case when r.revealed then c.guide_time end,
        'settledValue',r.settled_value,
        'oddsWeight',case when r.revealed then r.odds_weight end
       ) order by r.slot)
      from rips.batch_rewards r join rips.catalog c on c.id=r.item
      where r.batch=b.id
    ),'[]'::jsonb)
   ) from rips.batches b where b.id=requested_batch and b.owner=uid
 );
end $fn$;
revoke all on function rips.reward_session(text,jsonb)
 from public,anon,authenticated;

-- Keep the original server-side purchase and odds algorithm. Only route
-- reward management into the new owned, idempotent batch handler and prevent
-- additional purchases until the previous rewards are explicitly managed.
do $$
declare definition text;
begin
 select pg_get_functiondef('rips.command(text,jsonb)'::regprocedure)
 into definition;
 definition:=replace(definition,
   ' if action=''open'' then',
   ' if action in (''reward_batch'',''reward_reveal'',''reward_settle'') then return rips.reward_session(action,payload); end if;
 if action=''open'' then');
 definition:=replace(definition,
   'b.owner=uid and not r.revealed',
   'b.owner=uid and r.reward_status=''pending''');
 if definition not like '%return rips.reward_session(action,payload)%'
    or definition not like '%r.reward_status=''pending''%'
 then raise exception 'Could not patch the existing case command safely.'; end if;
 execute definition;
end $$;
