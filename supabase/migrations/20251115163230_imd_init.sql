-- IMDB schema for idol master DB
create schema if not exists imd;

-- Core groups table (minimal version)
create table if not exists imd.groups (
  id uuid primary key default gen_random_uuid(),
  name_ja text not null,
  slug text not null unique,
  status text not null default 'active'
    check (status in ('active', 'hiatus', 'disbanded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
