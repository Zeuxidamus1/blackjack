-- Keep recurring collection missions achievable for advanced collectors:
-- count different items actually revealed during the current period,
-- not only the first-ever entry in the permanent Collection Log.
update rips.mission_definitions set title='Collect 2 different items',
 description='Reveal two different item types from packs today.'
where id='daily_discover_2';
update rips.mission_definitions set title='Collect 8 different items',
 description='Reveal eight different item types from packs this week.'
where id='weekly_discover_8';

do $patch$
declare src text;
begin
 select pg_get_functiondef('rips.missions_board(text,jsonb)'::regprocedure) into src;
 src:=replace(src,
 'select count(*) into progress_count from rips.pulls p
     where p.owner=uid and p.first>=window_start and p.first<window_end;',
 'select count(distinct r.item) into progress_count
     from rips.batches b join rips.batch_rewards r on r.batch=b.id
     where b.owner=uid and b.created>=window_start and b.created<window_end
       and r.revealed;');
 if src not like '%count(distinct r.item)%' then
  raise exception 'Could not safely modify the mission discovery calculation';
 end if;
 execute src;
end $patch$;
