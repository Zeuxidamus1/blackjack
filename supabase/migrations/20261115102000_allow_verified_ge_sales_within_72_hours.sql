-- Permit player sales at the last verified OSRS GE quote up to 72 hours old.
-- The server still requires a positive quote and a genuine OSRS trade timestamp.
-- Never fabricate a quote or accept a user-submitted sale price.
-- All ownership, pending-reward, protection, listing and bulk atomicity checks remain.
do $extend_verified_ge_window$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('rips.reward_session(text,jsonb)'::regprocedure) into original;
  if position('row_record.guide_time<now()-interval ''24 hours''' in original)=0
  then raise exception 'Reward settlement sale window differs from expected source'; end if;
  src:=replace(original,
    'row_record.guide_time<now()-interval ''24 hours''',
    'row_record.guide_time<now()-interval ''72 hours''');
  execute src;

  select pg_get_functiondef('rips.sell_inventory_bulk(jsonb)'::regprocedure) into original;
  if position('c.guide_time>now()-interval ''24 hours''' in original)=0
  then raise exception 'Bulk sale window differs from expected source'; end if;
  src:=replace(original,
    'c.guide_time>now()-interval ''24 hours''',
    'c.guide_time>now()-interval ''72 hours''');
  execute src;

  select pg_get_functiondef('rips.economy_command(text,jsonb)'::regprocedure) into original;
  if position('ge_id is not null and guide_time>now()-interval ''24 hours''' in original)=0
  then raise exception 'Individual sale window differs from expected source'; end if;
  src:=replace(original,
    'ge_id is not null and guide_time>now()-interval ''24 hours''',
    'ge_id is not null and guide_time>now()-interval ''72 hours''');
  execute src;
end $extend_verified_ge_window$;