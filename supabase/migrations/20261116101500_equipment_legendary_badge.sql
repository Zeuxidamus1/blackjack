insert into rips.equipment_badges(code,title,description)
 values('legendary_piece','Legendary Find','Personally discover a Third Age equipment piece.')
 on conflict(code) do update set title=excluded.title,description=excluded.description;
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
   where pl.owner=uid and pl.count>0 and c.name ilike '3rd Age%'
 ) then
   insert into rips.equipment_achievements(owner,code)
     values(uid,'legendary_piece') on conflict do nothing;
 end if;
end $function$
