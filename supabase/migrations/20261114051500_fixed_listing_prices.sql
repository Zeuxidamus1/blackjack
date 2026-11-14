create or replace function rips.fixed_listing_price() returns trigger language plpgsql set search_path='' as $$
begin
 select c.guide into new.price from rips.items i join rips.catalog c on c.id=i.item where i.id=new.instance;
 if new.price is null or new.price<1 then raise exception 'No market guide price is available.'; end if;
 return new;
end $$;
revoke all on function rips.fixed_listing_price() from public;
alter table rips.listings drop constraint listings_price_check;
alter table rips.listings add constraint listings_price_check check(price>0);
create trigger fixed_listing_price before insert or update of price on rips.listings for each row execute function rips.fixed_listing_price();