-- Make future sales attributable to the actual owner. Historical sales intentionally remain untouched.
alter table rips.sales add column if not exists seller uuid references rips.players(id) on delete set null;
create index if not exists mission_sales_owner_idx on rips.sales(seller,sold desc);
