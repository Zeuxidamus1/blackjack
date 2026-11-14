-- Link each revealed reward to its exact inventory instance for a safe one-click keep/sell option.
-- Existing batch contents and old ownership records remain untouched.
alter table rips.batch_rewards
 add column if not exists instance uuid references rips.items(id) on delete set null;
do $$
declare src text;
begin
 select pg_get_functiondef('rips.command(text,jsonb)'::regprocedure) into src;
 src:=replace(src,'slot_no integer; reward text; ticket integer;',
   'slot_no integer; reward text; instance_id uuid; ticket integer;');
 src:=replace(src,'insert into rips.items(owner,item,origin) values(uid,reward,uid);',
   'insert into rips.items(owner,item,origin) values(uid,reward,uid) returning id into instance_id;
    update rips.batch_rewards set instance=instance_id where batch=batch_id and slot=slot_no;');
 src:=replace(src,'''item'',case when r.revealed then r.item end)',
   '''item'',case when r.revealed then r.item end,''instance'',case when r.revealed then r.instance end)');
 if src not like '%instance_id uuid%' or src not like '%set instance=instance_id%'
 then raise exception 'Reward instance patch did not apply'; end if;
 execute src;
end $$;