-- Group profiles (multi-language)
create table if not exists imd.group_profiles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references imd.groups(id) on delete cascade,
  locale text not null check (locale in ('ja', 'en')),
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, locale)
);
