-- Permit Pet Hunt's non-GE collectibles to sell for their existing, server-owned custom guide.
-- GE-traded rewards still require positive, current validated GE quotes.
-- Preserve ownership, pending reward protection, inventory locks and atomic settlement.
do $pet_sale$
declare
  src text;
  original text;
begin
  select pg_get_functiondef('rips.reward_session(text,jsonb)'::regprocedure) into original;
  src:=original;
  src:=replace(src,'select r.slot,r.instance,r.item,c.ge_id,c.guide,c.guide_time',
                   'select r.slot,r.instance,r.item,c.ge_id,c.guide,c.guide_time,c.pack');
  src:=replace(src,'if row_record.ge_id is null or row_record.guide<1',
                   'if row_record.guide<1 or (row_record.ge_id is null and row_record.pack<>''pets'')');
  src:=replace(src,'or row_record.guide_time is null',
                   'or (row_record.ge_id is not null and row_record.guide_time is null)');
  src:=replace(src,'or row_record.guide_time<now()-interval ''24 hours''',
                   'or (row_record.ge_id is not null and row_record.guide_time<now()-interval ''24 hours'')');
  if src=original
     or position('select r.slot,r.instance,r.item,c.ge_id,c.guide,c.guide_time,c.pack' in src)=0
     or position('if row_record.guide<1 or (row_record.ge_id is null and row_record.pack<>''pets'')' in src)=0
     or position('or (row_record.ge_id is not null and row_record.guide_time is null)' in src)=0
     or position('or (row_record.ge_id is not null and row_record.guide_time<now()-interval ''24 hours'')' in src)=0
  then raise exception 'Reward settlement source changed. Review the migration before applying.'; end if;
  execute src;

  select pg_get_functiondef('rips.sell_inventory_bulk(jsonb)'::regprocedure) into original;
  src:=replace(original,
    'and c.ge_id is not null and c.guide>0
    and c.guide_time>now()-interval ''24 hours'';',
    'and c.guide>0 and ((c.ge_id is null and c.pack=''pets'')
      or (c.ge_id is not null and c.guide_time>now()-interval ''24 hours''));');
  if src=original or position('c.ge_id is null and c.pack=''pets''' in src)=0
  then raise exception 'Bulk sale source changed. Review the migration before applying.'; end if;
  execute src;

  select pg_get_functiondef('rips.economy_command(text,jsonb)'::regprocedure) into original;
  src:=replace(original,
    'where id=asset.item and ge_id is not null
        and guide>0 and guide_time>now()-interval ''24 hours'';',
    'where id=asset.item and guide>0
        and ((ge_id is null and pack=''pets'')
          or (ge_id is not null and guide_time>now()-interval ''24 hours''));');
  if src=original or position('ge_id is null and pack=''pets''' in src)=0
  then raise exception 'Individual sale source changed. Review the migration before applying.'; end if;
  execute src;
end
$pet_sale$;
