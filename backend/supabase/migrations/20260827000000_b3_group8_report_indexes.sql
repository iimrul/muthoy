-- B3 Group 8 report indexes. Local file only; do not execute remotely without approval.
update sales set business_date=(created_at at time zone 'Asia/Dhaka')::date where business_date is null;
create index if not exists sales_shop_business_date_idx on sales(shop_id,business_date);
create index if not exists sale_refunds_shop_business_date_idx on sale_refunds(shop_id,business_date);
create index if not exists credits_shop_created_idx on credits(shop_id,created_at);
