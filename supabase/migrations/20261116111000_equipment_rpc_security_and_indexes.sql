-- Public equipment RPC is now SECURITY INVOKER, matching the preexisting
-- public.rips_command facade. Internal command validates auth.uid() and owns
-- the privileged writes; no table access is granted to browser roles.
alter function public.rips_equipment_command(text,jsonb) security invoker;
grant execute on function rips.equipment_command(text,jsonb) to authenticated;
revoke execute on function rips.equipment_command(text,jsonb) from anon,public;
create index if not exists equipment_achievements_code_idx on rips.equipment_achievements(code);
create index if not exists equipment_goals_set_id_idx on rips.equipment_goals(set_id);
create index if not exists equipment_profiles_title_code_idx on rips.equipment_profiles(title_code);