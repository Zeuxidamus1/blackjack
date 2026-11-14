-- Pending rewards are escrowed in the player's inventory until the player
-- explicitly vaults or sells them. Legacy inventory commands may not bypass
-- the batch settlement flow, and pending rewards aren't shown as owned assets.
do $$
declare src text;
begin
 select pg_get_functiondef('rips.economy_command(text,jsonb)'::regprocedure) into src;
 src:=replace(src,
   'where i.owner=uid),''[]''::jsonb)',
   'where i.owner=uid
      and not exists (
        select 1 from rips.batch_rewards pending
        where pending.instance=i.id and pending.reward_status=''pending''
      )),''[]''::jsonb)');
 src:=replace(src,
   'if asset.id is null then raise exception ''You do not own this item.''; end if;',
   'if asset.id is null then raise exception ''You do not own this item.''; end if;
      if exists (
        select 1 from rips.batch_rewards pending
        where pending.instance=target and pending.reward_status=''pending''
      ) then raise exception ''Resolve this item in your pack rewards first.''; end if;');
 if src not like '%Resolve this item in your pack rewards first.%'
   or src not like '%pending.instance=i.id%'
 then raise exception 'Pending-item guard did not apply to economy commands.'; end if;
 execute src;
end $$;