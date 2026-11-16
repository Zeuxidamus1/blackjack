-- Challenger Rips: equipment, verified collectible sets, goals, badges and showroom.
-- Existing reward_status='vaulted' remains unchanged; "Bank" is a UI-only rename.
-- No changes to catalog guide values, draw odds, player GP or historical pulls.
create table if not exists rips.equipment_definitions (
  item text primary key references rips.catalog(id) on delete cascade,
  ge_id integer not null,
  slot text not null check (slot in ('head','cape','neck','ammo','weapon','body','shield','legs','hands','feet','ring')),
  two_handed boolean not null default false,
  check (not two_handed or slot='weapon')
);
create index if not exists equipment_defs_ge_id_idx on rips.equipment_definitions(ge_id);

-- Conservative item-name matcher; exclude non-wearable ornament components, pages,
-- crafting inputs and scrolls. Exact 5-set metadata gets explicit overrides below.
with candidates as (
 select c.id,c.ge_id,c.name,
 case
 when c.ge_id is null or c.name ~* '(ornament kit|blessing scroll|page [1-4]|arrowtips|fletching|blueprint|broken|shard|teleport|upgrade scroll|unstrung|attachment|patch)' then null
 when lower(c.name) ~ '(arrows?$|bolts?$| bolts? \(| arrows? \(|blessing$)' then 'ammo'
 when lower(c.name) ~ '(full helm|full helmet|helmet| helm|helm$|hood$|coif$|hat$| headband|mask$|mitre$|wig$|boater$|cavalier$|beret$|tiara$|cap$|^afro$)' then 'head'
 when lower(c.name) ~ '(cape$|cloak$|wings$)' then 'cape'
 when lower(c.name) ~ '(amulet|necklace|stole$|scarf$|symbol$)' then 'neck'
 when lower(c.name) ~ '(^ring | ring |^ring$)' then 'ring'
 when lower(c.name) ~ '(platebody|chainbody|chestplate|robe top|robetop|d.hide body|leathertop|brassard|shirt|tunic|blouse|jacket|vest$| range top$|^ankou top$)' then 'body'
 when lower(c.name) ~ '(platelegs|plateskirt|chainskirt|robe bottom|robe legs|robe skirt|robeskirt|leatherskirt|chaps|trousers|kilt| legs$| skirt$|bottoms$|^3rd age robe$|ankou.s leggings)' then 'legs'
 when lower(c.name) ~ '(gloves|vambraces|bracers|gauntlets|cuffs|bracelet)' then 'hands'
 when lower(c.name) ~ '(boots|shoes|slippers|sandals|socks$)' then 'feet'
 when lower(c.name) ~ '(kiteshield|shield$|shield \(|defender$|ward$|buckler$|tome$|book of)' then 'shield'
 when lower(c.name) ~ '(scimitar|longsword|shortsword|godsword|sword|dagger|battleaxe|greataxe|axe$|mace|spear|staff|wand|bow$|crossbow|whip|rapier|halberd|maul|flail|hammers|cane$|pickaxe|bludgeon|scythe|trident|sceptre|warhammer|club$|crozier$)' then 'weapon'
 else null end as slot
 from rips.catalog c
)
insert into rips.equipment_definitions(item,ge_id,slot,two_handed)
select id,ge_id,slot,
       slot='weapon' and lower(name) ~ '(2h sword|godsword|greataxe|halberd|maul|scythe|bludgeon|longbow|shortbow| bow$|spear|hammers)'
from candidates where slot is not null
on conflict (item) do update set ge_id=excluded.ge_id,slot=excluded.slot,two_handed=excluded.two_handed;

create table if not exists rips.equipment_sets (
  id text primary key,
  name text not null,
  tier text not null check (tier in ('starter','intermediate','advanced','prestige')),
  description text not null
);
create table if not exists rips.equipment_set_pieces (
  set_id text not null references rips.equipment_sets(id) on delete cascade,
  ge_id integer not null,
  slot text not null,
  position integer not null,
  primary key(set_id,ge_id),
  unique(set_id,position)
);
insert into rips.equipment_sets(id,name,tier,description) values
('rune','Rune Armour','starter','Your first complete melee armour collection.'),
('dragon','Dragon Armour','intermediate','Obtain the dragon helm, platebody, platelegs and shield.'),
('ancestral','Ancestral Robes','advanced','Complete the three-piece ancestral mage outfit.'),
('armadyl','Armadyl Armour','advanced','Complete the classic ranged armour collection.'),
('third_age','Third Age Melee','prestige','An exceptionally rare, optional four-piece prestige collection.')
on conflict(id) do update set name=excluded.name,tier=excluded.tier,description=excluded.description;
insert into rips.equipment_set_pieces(set_id,ge_id,slot,position) values
('rune',1163,'head',1),('rune',1127,'body',2),('rune',1079,'legs',3),('rune',1201,'shield',4),
('dragon',11335,'head',1),('dragon',21892,'body',2),('dragon',4087,'legs',3),('dragon',21895,'shield',4),
('ancestral',21018,'head',1),('ancestral',21021,'body',2),('ancestral',21024,'legs',3),
('armadyl',11826,'head',1),('armadyl',11828,'body',2),('armadyl',11830,'legs',3),
('third_age',10350,'head',1),('third_age',10348,'body',2),('third_age',10346,'legs',3),('third_age',10352,'shield',4)
on conflict(set_id,ge_id) do update set slot=excluded.slot,position=excluded.position;
do $check_definitions$
begin
 if exists(
  select 1 from rips.equipment_set_pieces p
  where not exists(select 1 from rips.equipment_definitions d
    where d.ge_id=p.ge_id and d.slot=p.slot)
  or not exists(select 1 from rips.case_rewards r
    join rips.catalog c on c.id=r.item where c.ge_id=p.ge_id and r.weight>0)
 ) then
  raise exception 'Equipment set contains an absent or incorrectly classified item';
 end if;
end $check_definitions$;

create table if not exists rips.equipment_slots (
  owner uuid not null references rips.players(id) on delete cascade,
  slot text not null check(slot in ('head','cape','neck','ammo','weapon','body','shield','legs','hands','feet','ring')),
  instance uuid not null unique references rips.items(id) on delete restrict,
  equipped_at timestamptz not null default now(),
  primary key(owner,slot)
);
create table if not exists rips.equipment_goals (
  owner uuid primary key references rips.players(id) on delete cascade,
  set_id text not null references rips.equipment_sets(id),
  updated_at timestamptz not null default now()
);
create table if not exists rips.equipment_badges (
  code text primary key,
  title text not null,
  description text not null
);
insert into rips.equipment_badges(code,title,description) values
('first_equip','First Steps','Equip your first piece of gear.'),
('first_set','Set Collector','Own every piece of an equipment set.'),
('three_sets','Arsenal Collector','Complete three distinct equipment sets.'),
('rune','Rune Guardian','Complete the Rune Armour collection.'),
('dragon','Dragon Warden','Complete the Dragon Armour collection.'),
('ancestral','Ancestral Scholar','Complete the Ancestral Robes collection.'),
('armadyl','Armadyl Sentinel','Complete the Armadyl Armour collection.'),
('third_age','Third Age Legend','Complete the Third Age Melee collection.'),
('full_equipped','Battle Ready','Equip every piece of one complete set.')
on conflict(code) do update set title=excluded.title,description=excluded.description;
create table if not exists rips.equipment_achievements (
  owner uuid not null references rips.players(id) on delete cascade,
  code text not null references rips.equipment_badges(code),
  earned_at timestamptz not null default now(),
  primary key(owner,code)
);
create table if not exists rips.equipment_profiles (
  owner uuid primary key references rips.players(id) on delete cascade,
  title_code text references rips.equipment_badges(code)
);
create table if not exists rips.equipment_events (
  id bigint generated always as identity primary key,
  owner uuid not null references rips.players(id) on delete cascade,
  event text not null,
  context text,
  created_at timestamptz not null default now()
);
create index if not exists equipment_events_owner_idx on rips.equipment_events(owner,created_at desc);

alter table rips.equipment_definitions enable row level security;
alter table rips.equipment_sets enable row level security;
alter table rips.equipment_set_pieces enable row level security;
alter table rips.equipment_slots enable row level security;
alter table rips.equipment_goals enable row level security;
alter table rips.equipment_badges enable row level security;
alter table rips.equipment_achievements enable row level security;
alter table rips.equipment_profiles enable row level security;
alter table rips.equipment_events enable row level security;
revoke all on rips.equipment_definitions,rips.equipment_sets,rips.equipment_set_pieces,
  rips.equipment_slots,rips.equipment_goals,rips.equipment_badges,
  rips.equipment_achievements,rips.equipment_profiles,rips.equipment_events from public,anon,authenticated;

-- Block ALL sale paths (single, bulk, salvage, marketplace transfers) at the
-- database boundary. Existing sales/listing RPCs still own authorization/GP.
create or replace function rips.equipment_item_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from rips.equipment_slots e where e.instance=old.id) then
   raise exception 'Unequip this item before selling, listing or transferring it.';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
drop trigger if exists equipment_item_guard_delete on rips.items;
create trigger equipment_item_guard_delete before delete on rips.items
 for each row execute function rips.equipment_item_guard();
drop trigger if exists equipment_item_guard_transfer on rips.items;
create trigger equipment_item_guard_transfer before update of owner,item on rips.items
 for each row execute function rips.equipment_item_guard();

create or replace function rips.equipment_listing_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from rips.equipment_slots e where e.instance=new.instance) then
   raise exception 'Unequip this item before listing it.';
 end if;
 return new;
end $$;
drop trigger if exists equipment_listing_guard on rips.listings;
create trigger equipment_listing_guard before insert or update of instance on rips.listings
  for each row execute function rips.equipment_listing_guard();

-- A single item instance is equipped at most once, and one slot per player.
-- Restrict direct writes to owner-validated RPCs only.
create or replace function rips.equipment_equip_owned(uid uuid,item_instance uuid)
returns text language plpgsql security definer set search_path='' as $$
declare equip_slot text; both_hands boolean;
begin
 select d.slot,d.two_handed into equip_slot,both_hands
 from rips.items i join rips.equipment_definitions d on d.item=i.item
 where i.id=item_instance and i.owner=uid for update of i;
 if not found then raise exception 'This item is not owned or cannot be equipped.'; end if;
 if exists(select 1 from rips.listings l where l.instance=item_instance)
 then raise exception 'Cancel the listing before equipping.'; end if;
 if exists(select 1 from rips.batch_rewards p
           where p.instance=item_instance and p.reward_status='pending')
 then raise exception 'Bank the reward before equipping.'; end if;
 delete from rips.equipment_slots where owner=uid and
   (slot=equip_slot or instance=item_instance);
 if both_hands then
   delete from rips.equipment_slots where owner=uid and slot='shield';
 elsif equip_slot='shield' then
   delete from rips.equipment_slots e using rips.items i,rips.equipment_definitions d
   where e.owner=uid and e.slot='weapon' and e.instance=i.id
     and i.item=d.item and d.two_handed;
 end if;
 insert into rips.equipment_slots(owner,slot,instance) values(uid,equip_slot,item_instance);
 return equip_slot;
end $$;

create or replace function rips.equipment_sets_state(uid uuid)
returns jsonb language sql stable security definer set search_path='' as $$
with pieces as (
select p.set_id,p.ge_id,p.slot,p.position,
  (select c.name from rips.catalog c where c.ge_id=p.ge_id order by c.id limit 1) name,
  exists(select 1 from rips.pulls pl join rips.catalog c on c.id=pl.item
     where pl.owner=uid and pl.count>0 and c.ge_id=p.ge_id) as discovered,
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
$$;

create or replace function rips.equipment_award(uid uuid,sets jsonb)
returns void language plpgsql security definer set search_path='' as $$
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
end $$;

create or replace function rips.equipment_command(action text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); iid uuid; id text; equipped_slot text;
        sets jsonb; data jsonb; total integer:=0; matchrow record;
begin
 if uid is null then raise exception 'Sign in to use equipment.'; end if;
 if action not in ('status','showcase','equip','unequip','equip_set','goal','title')
 then raise exception 'Unknown equipment action.'; end if;
 if action='showcase' then
   iid:=nullif(payload->>'owner','')::uuid;
   if iid is null then raise exception 'A player ID is required.'; end if;
   return (
     select jsonb_build_object(
      'name',p.name,
      'title',(select b.title from rips.equipment_profiles pr
          join rips.equipment_badges b on b.code=pr.title_code where pr.owner=iid),
      'slots',coalesce((select jsonb_agg(jsonb_build_object(
         'slot',e.slot,'name',c.name,'geId',c.ge_id) order by e.slot)
         from rips.equipment_slots e join rips.items i on i.id=e.instance
         join rips.catalog c on c.id=i.item where e.owner=iid),'[]'::jsonb),
      'badges',coalesce((select jsonb_agg(jsonb_build_object(
          'code',a.code,'title',b.title,'earnedAt',a.earned_at) order by a.earned_at desc)
          from rips.equipment_achievements a join rips.equipment_badges b on b.code=a.code
          where a.owner=iid),'[]'::jsonb)
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
   id:=payload->>'slot';
   if id is null or id not in
      ('head','cape','neck','ammo','weapon','body','shield','legs','hands','feet','ring')
   then raise exception 'Select a valid equipment slot.'; end if;
   delete from rips.equipment_slots where owner=uid and slot=id;
   if found then insert into rips.equipment_events(owner,event,context)
     values(uid,'unequip',id); end if;
 elsif action='equip_set' then
   id:=payload->>'set';
   if not exists(select 1 from rips.equipment_sets where id=rips.equipment_command.id)
   then raise exception 'Unknown equipment set.'; end if;
   for matchrow in
     select p.ge_id,(select i.id
       from rips.items i join rips.catalog c on c.id=i.item
       where i.owner=uid and c.ge_id=p.ge_id
       and not exists(select 1 from rips.batch_rewards br where br.instance=i.id and br.reward_status='pending')
       and not exists(select 1 from rips.listings l where l.instance=i.id)
       order by i.acquired,i.id limit 1) instance
     from rips.equipment_set_pieces p where p.set_id=id order by p.position
   loop
     if matchrow.instance is not null then
       perform rips.equipment_equip_owned(uid,matchrow.instance);
       total:=total+1;
     end if;
   end loop;
   if total=0 then raise exception 'Bank a piece of this set first.'; end if;
   insert into rips.equipment_events(owner,event,context)
    values(uid,'equip_set',id);
 elsif action='goal' then
   id:=payload->>'set';
   if not exists(select 1 from rips.equipment_sets where id=rips.equipment_command.id)
   then raise exception 'Unknown equipment goal.'; end if;
   insert into rips.equipment_goals(owner,set_id) values(uid,id)
     on conflict(owner) do update set set_id=excluded.set_id,updated_at=now();
   insert into rips.equipment_events(owner,event,context) values(uid,'pin_goal',id);
 end if;
 sets:=rips.equipment_sets_state(uid);
 perform rips.equipment_award(uid,sets);
 if action='title' then
   id:=nullif(payload->>'code','');
   if id is not null and not exists(
    select 1 from rips.equipment_achievements a where a.owner=uid and a.code=id)
   then raise exception 'You have not earned this title.'; end if;
   insert into rips.equipment_profiles(owner,title_code) values(uid,id)
     on conflict(owner) do update set title_code=excluded.title_code;
   insert into rips.equipment_events(owner,event,context)
     values(uid,'title',id);
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
end $$;

create or replace function public.rips_equipment_command(action text,payload jsonb default '{}'::jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select rips.equipment_command(action,payload);
$$;
revoke all on function public.rips_equipment_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.rips_equipment_command(text,jsonb) to authenticated;
revoke all on function rips.equipment_command(text,jsonb) from public,anon,authenticated;
revoke all on function rips.equipment_equip_owned(uuid,uuid) from public,anon,authenticated;
revoke all on function rips.equipment_sets_state(uuid) from public,anon,authenticated;
revoke all on function rips.equipment_award(uuid,jsonb) from public,anon,authenticated;
