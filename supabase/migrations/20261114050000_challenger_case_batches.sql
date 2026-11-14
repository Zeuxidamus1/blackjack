alter table rips.players alter column gp set default 100000;
create table rips.cases (
 id text primary key, pack text not null, name text not null, price bigint not null check(price>0)
);
create table rips.case_rewards (
 case_id text references rips.cases, item text references rips.catalog,
 weight integer not null check(weight>0), chase boolean not null,
 primary key(case_id,item)
);
create table rips.batches (
 id uuid primary key, owner uuid not null references rips.players on delete cascade,
 case_id text not null references rips.cases, quantity integer not null check(quantity between 1 and 5),
 paid bigint not null, created timestamptz not null default now()
);
create table rips.batch_rewards (
 batch uuid references rips.batches on delete cascade, slot integer not null,
 item text not null references rips.catalog, revealed boolean not null default false,
 primary key(batch,slot)
);
alter table rips.cases enable row level security;
alter table rips.case_rewards enable row level security;
alter table rips.batches enable row level security;
alter table rips.batch_rewards enable row level security;
create index on rips.batches(owner,created desc);
insert into rips.cases
select p||'-'||tier,p, label, price
from unnest(array['boss','clue','pets']) p
cross join (values ('starter','Starter',1000),('select','Select',2500),('premium','Premium',25000)) t(tier,label,price);
update rips.cases set price=250000 where id='boss-premium';
with companions as (
 select id,row_number() over(order by id) n from rips.catalog where pack='pets' and guide=100000 and ge_id is null
)
update rips.catalog c set guide=case when companions.n<=4 then 700 when companions.n<=8 then 1750 else 4500 end
from companions where companions.id=c.id;
update rips.cases set price=7500 where id='pets-select';
update rips.cases set price=12000000 where id='pets-premium';
with candidates as (
 select c.id case_id,i.id item,
 row_number() over(partition by c.id order by abs(ln(greatest(i.guide,1)::numeric / (c.price*0.72))),i.id) n
 from rips.cases c join rips.catalog i on i.pack=c.pack
 where i.id not in ('bow','ely','pick','fish','log') and i.guide>0 and (c.pack<>'pets' or c.id='pets-premium' or i.guide<10000)
), selected as (
 select case_id,item,n,count(*) over(partition by case_id) size from candidates where n<=8
)
insert into rips.case_rewards
select case_id,item,(999999/size + case when n<=999999%size then 1 else 0 end)::integer,false from selected;
insert into rips.case_rewards
select c.id, chase.id,1,true
from rips.cases c cross join lateral (
 select i.id from rips.catalog i where i.pack=c.pack and i.guide>0
 and not exists(select 1 from rips.case_rewards r where r.case_id=c.id and r.item=i.id)
 and (c.id='boss-premium' and i.id='bow' or c.id<>'boss-premium' and i.id not in ('bow','ely'))
 order by abs(ln(i.guide::numeric/(case when c.pack='pets' then 100000000 when c.id like '%premium' then 100000000 else 10000000 end))), i.id
 limit 1
) chase;
alter function rips.command(text,jsonb) rename to economy_command;
revoke all on function rips.economy_command(text,jsonb) from public,authenticated;
create function rips.command(action text,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); batch_id uuid; previous rips.batches; chosen rips.cases;
 qty integer; slot_no integer; reward text; ticket integer; result jsonb; balance bigint; pull_count integer;
begin
 if uid is null then raise exception 'Sign in first.'; end if;
 if action='open' then raise exception 'Refresh the page to open a case.'; end if;
 if action='cases' then
   return (select jsonb_agg(jsonb_build_object('id',c.id,'pack',c.pack,'name',c.name,'price',c.price,
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
     if exists(select 1 from rips.batches b join rips.batch_rewards r on r.batch=b.id where b.owner=uid and not r.revealed) then
       raise exception 'Reveal your current batch first.';
     end if;
     perform rips.economy_command('state','{}');
     select gp into balance from rips.players where id=uid;
     if balance<chosen.price*qty then raise exception 'You need more GP.'; end if;
     update rips.players set gp=gp-chosen.price*qty where id=uid;
     insert into rips.batches(id,owner,case_id,quantity,paid) values(batch_id,uid,chosen.id,qty,chosen.price*qty);
     for slot_no in 1..qty loop
       ticket:=floor(random()*1000000)::integer;
       select item into strict reward from (
         select item,sum(weight) over(order by item) cutoff from rips.case_rewards where case_id=chosen.id
       ) r where cutoff>ticket order by cutoff limit 1;
       insert into rips.batch_rewards(batch,slot,item) values(batch_id,slot_no,reward);
       insert into rips.items(owner,item,origin) values(uid,reward,uid);
       insert into rips.pulls(owner,item) values(uid,reward)
       on conflict(owner,item) do update set count=rips.pulls.count+1 returning count into pull_count;
       if pull_count=1 and (select count(*) from rips.pulls where owner=uid)%3=0 then
         update rips.players set gp=gp+2000000 where id=uid;
       end if;
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
 (select jsonb_agg(jsonb_build_object('slot',r.slot,'item',case when r.revealed then r.item end) order by r.slot)
 from rips.batch_rewards r where r.batch=b.id))
 into result from rips.batches b where b.id=batch_id and b.owner=uid;
 return result;
end $$;
revoke all on function rips.command(text,jsonb) from public;
grant execute on function rips.command(text,jsonb) to authenticated;
create or replace function public.rips_command(action text,payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
select rips.command(action,payload);
$$;
do $$ begin
 if exists(select 1 from rips.cases c left join rips.case_rewards r on r.case_id=c.id group by c.id having sum(r.weight) is distinct from 1000000 or count(*) filter(where r.chase)<>1)
 then raise exception 'Invalid case weights'; end if;
end $$;
update rips.cases set price=1000000 where id='boss-premium';
update rips.cases set price=4000 where id='pets-select';
with weights as (
 select r.case_id,r.item,case when i.guide<=700 then 650000 else 349999/3 end weight
 from rips.case_rewards r join rips.catalog i on i.id=r.item where r.case_id='pets-starter' and not r.chase
), ranked as (
 select case_id,item,weight,row_number() over(order by item) n,sum(weight) over() total from weights
)
update rips.case_rewards r set weight=greatest(1,(999999*ranked.weight::bigint/ranked.total)::integer)+
 case when ranked.n=1 then 999999-(select sum(999999*weight::bigint/ranked.total) from weights) else 0 end
from ranked where r.case_id=ranked.case_id and r.item=ranked.item;
do $$ begin
 if (select sum(weight) from rips.case_rewards where case_id='pets-starter')<>1000000 then raise exception 'Invalid pet weights'; end if;
end $$;
do $$ declare definition text; begin
select pg_get_functiondef('rips.command(text,jsonb)'::regprocedure) into definition;
definition:=replace(definition,'; pull_count integer;', ';');
definition:=replace(definition,$old$ returning count into pull_count;
       if pull_count=1 and (select count(*) from rips.pulls where owner=uid)%3=0 then
         update rips.players set gp=gp+2000000 where id=uid;
       end if;$old$,';');
execute definition;
end $$;