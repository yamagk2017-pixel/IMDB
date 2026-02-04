-- Group attributes (members / location / agency) with locale
create table if not exists imd.group_attributes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references imd.groups(id) on delete cascade,
  key text not null check (key in ('members', 'location', 'agency')),
  locale text not null check (locale in ('ja', 'en')),
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, key, locale)
);
