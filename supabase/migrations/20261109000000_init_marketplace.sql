create extension if not exists pgcrypto;

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  title varchar(255) not null,
  description text,
  price numeric(10,2) not null check (price >= 0),
  category varchar(100) not null,
  condition varchar(50) not null default 'Used - Good',
  seller_email varchar(255) not null,
  image_url text,
  location varchar(255) default 'Palo Alto, CA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete cascade,
  buyer_email varchar(255) not null,
  seller_email varchar(255) not null,
  message text not null,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values ('listing-images', 'listing-images', true)
on conflict (id) do update set public = excluded.public;

create index if not exists idx_listings_category on public.listings(category);
create index if not exists idx_listings_created_at on public.listings(created_at desc);
create index if not exists idx_messages_listing_id on public.messages(listing_id);

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_listings_updated_at on public.listings;
create trigger update_listings_updated_at
before update on public.listings
for each row execute function public.update_updated_at_column();

alter table public.listings enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Anyone can view listings" on public.listings;
create policy "Anyone can view listings" on public.listings for select using (true);

drop policy if exists "Anyone can create listings" on public.listings;
create policy "Anyone can create listings" on public.listings for insert with check (true);

drop policy if exists "Anyone can create messages" on public.messages;
create policy "Anyone can create messages" on public.messages for insert with check (true);

drop policy if exists "Anyone can upload listing images" on storage.objects;
create policy "Anyone can upload listing images" on storage.objects
for insert with check (bucket_id = 'listing-images');

drop policy if exists "Anyone can view listing images" on storage.objects;
create policy "Anyone can view listing images" on storage.objects
for select using (bucket_id = 'listing-images');
