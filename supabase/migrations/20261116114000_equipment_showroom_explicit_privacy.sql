-- Showroom privacy is opt-in; existing gear and badges remain private.
alter table rips.equipment_profiles add column if not exists share_gear boolean not null default false;
alter table rips.equipment_profiles add column if not exists share_badges boolean not null default false;
CREATE OR REPLACE FUNCTION rips.equipment_command(action text, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare uid uuid:=auth.uid(); iid uuid; set_key text; equipped_slot text;
        sets jsonb; data jsonb; total integer:=0; matchrow record;
begin
 if uid is null then raise exception 'Sign in to use equipment.'; end if;
 if action not in ('status','showcase','equip','unequip','equip_set','goal','title','visibility')
 then raise exception 'Unknown equipment action.'; end if;
 if action='showcase' then
   iid:=nullif(payload->>'owner','')::uuid;
   if iid is null then raise exception 'A player ID is required.'; end if;
   return (
     select jsonb_build_object(
      'name',p.name,
      'title',(select case when uid=iid or pr.share_badges then b.title end from rips.equipment_profiles pr
          left join rips.equipment_badges b on b.code=pr.title_code where pr.owner=iid),
      'visibility',jsonb_build_object(
         'gear',coalesce((select share_gear from rips.equipment_profiles where owner=iid),false),
         'badges',coalesce((select share_badges from rips.equipment_profiles where owner=iid),false)),
      'slots',case when uid=iid or coalesce((select share_gear from rips.equipment_profiles where owner=iid),false)
        then coalesce((select jsonb_agg(jsonb_build_object(
         'slot',e.slot,'name',c.name,'geId',c.ge_id) order by e.slot)
         from rips.equipment_slots e join rips.items i on i.id=e.instance
         join rips.catalog c on c.id=i.item where e.owner=iid),'[]'::jsonb)
        else '[]'::jsonb end,
      'badges',case when uid=iid or coalesce((select share_badges from rips.equipment_profiles where owner=iid),false)
        then coalesce((select jsonb_agg(jsonb_build_object(
          'code',a.code,'title',b.title,'earnedAt',a.earned_at) order by a.earned_at desc)
          from rips.equipment_achievements a join rips.equipment_badges b on b.code=a.code
          where a.owner=iid),'[]'::jsonb)
        else '[]'::jsonb end
     ) from rips.players p where p.id=iid
   );
 end if;
 if not exists(select 1 from rips.players where id=uid)
 then raise exception 'Create your player first.'; end if;
 if action<>'status' then
   perform pg_advisory_xact_lock(194712855);
 end if;
 if action='equip' then
   iid:=nullif(payload->>'id','')::uuid;
   if iid is null then raise exception 'Select a banked item.'; end if;
   equipped_slot:=rips.equipment_equip_owned(uid,iid);
   insert into rips.equipment_events(owner,event,context)
     values(uid,'equip',equipped_slot);
 elsif action='unequip' then
   set_key:=payload->>'slot';
   if set_key is null or set_key not in
      ('head','cape','neck','ammo','weapon','body','shield','legs','hands','feet','ring')
   then raise exception 'Select a valid equipment slot.'; end if;
   delete from rips.equipment_slots where owner=uid and slot=set_key;
   if found then insert into rips.equipment_events(owner,event,context)
     values(uid,'unequip',set_key); end if;
 elsif action='equip_set' then
   set_key:=payload->>'set';
   if not exists(select 1 from rips.equipment_sets where id=set_key)
   then raise exception 'Unknown equipment set.'; end if;
   for matchrow in
     select p.ge_id,(select i.id
       from rips.items i join rips.catalog c on c.id=i.item
       where i.owner=uid and c.ge_id=p.ge_id
       and not exists(select 1 from rips.batch_rewards br where br.instance=i.id and br.reward_status='pending')
       and not exists(select 1 from rips.listings l where l.instance=i.id)
       order by i.acquired,i.id limit 1) instance
     from rips.equipment_set_pieces p where p.set_id=set_key order by p.position
   loop
     if matchrow.instance is not null then
       perform rips.equipment_equip_owned(uid,matchrow.instance);
       total:=total+1;
     end if;
   end loop;
   if total=0 then raise exception 'Bank a piece of this set first.'; end if;
   insert into rips.equipment_events(owner,event,context)
    values(uid,'equip_set',set_key);
 elsif action='visibility' then
    if payload ? 'gear' and jsonb_typeof(payload->'gear')<>'boolean' then
      raise exception 'Gear visibility must be a boolean.';
    end if;
    if payload ? 'badges' and jsonb_typeof(payload->'badges')<>'boolean' then
      raise exception 'Badge visibility must be a boolean.';
    end if;
    if not(payload ? 'gear' or payload ? 'badges') then
      raise exception 'Choose whether to share gear or badges.';
    end if;
    insert into rips.equipment_profiles(owner,share_gear,share_badges)
      values(uid,coalesce((payload->>'gear')::boolean,false),
             coalesce((payload->>'badges')::boolean,false))
    on conflict(owner) do update set
      share_gear=case when payload ? 'gear' then excluded.share_gear else rips.equipment_profiles.share_gear end,
      share_badges=case when payload ? 'badges' then excluded.share_badges else rips.equipment_profiles.share_badges end;
    insert into rips.equipment_events(owner,event,context)
      values(uid,'showroom_visibility','Privacy choices changed');
 elsif action='goal' then
   set_key:=payload->>'set';
   if not exists(select 1 from rips.equipment_sets where id=set_key)
   then raise exception 'Unknown equipment goal.'; end if;
   insert into rips.equipment_goals(owner,set_id) values(uid,set_key)
     on conflict(owner) do update set set_id=excluded.set_id,updated_at=now();
   insert into rips.equipment_events(owner,event,context) values(uid,'pin_goal',set_key);
 end if;
 sets:=rips.equipment_sets_state(uid);
 perform rips.equipment_award(uid,sets);
 if action='title' then
   set_key:=nullif(payload->>'code','');
   if set_key is not null and not exists(
    select 1 from rips.equipment_achievements a where a.owner=uid and a.code=set_key)
   then raise exception 'You have not earned this title.'; end if;
   insert into rips.equipment_profiles(owner,title_code) values(uid,set_key)
     on conflict(owner) do update set title_code=excluded.title_code;
   insert into rips.equipment_events(owner,event,context)
     values(uid,'title',set_key);
 end if;
 select jsonb_build_object(
  'slots',coalesce((select jsonb_agg(jsonb_build_object(
    'slot',e.slot,'instance',e.instance,'item',i.item,'name',c.name,
    'geId',c.ge_id,'value',c.guide,'twoHanded',d.two_handed,'protected',i.protected)
    order by e.slot)
    from rips.equipment_slots e join rips.items i on i.id=e.instance
    join rips.catalog c on c.id=i.item join rips.equipment_definitions d on d.item=i.item
    where e.owner=uid),'[]'::jsonb),
  'definitions',coalesce((select jsonb_agg(jsonb_build_object(
    'id',d.item,'geId',d.ge_id,'slot',d.slot,'twoHanded',d.two_handed))
    from rips.equipment_definitions d),'[]'::jsonb),
  'sets',sets,
  'goal',(select g.set_id from rips.equipment_goals g where g.owner=uid),
  'title',(select pr.title_code from rips.equipment_profiles pr where pr.owner=uid),
  'visibility',jsonb_build_object(
    'gear',coalesce((select pr.share_gear from rips.equipment_profiles pr where pr.owner=uid),false),
    'badges',coalesce((select pr.share_badges from rips.equipment_profiles pr where pr.owner=uid),false)),
  'achievements',coalesce((select jsonb_agg(jsonb_build_object(
   'code',a.code,'title',b.title,'description',b.description,'earnedAt',a.earned_at)
   order by a.earned_at desc)
   from rips.equipment_achievements a join rips.equipment_badges b on b.code=a.code
   where a.owner=uid),'[]'::jsonb),
  'eligibleTitles',coalesce((select jsonb_agg(jsonb_build_object(
   'code',a.code,'title',b.title) order by b.title)
   from rips.equipment_achievements a join rips.equipment_badges b on b.code=a.code
   where a.owner=uid),'[]'::jsonb)
 ) into data;
 return data;
end $function$;
