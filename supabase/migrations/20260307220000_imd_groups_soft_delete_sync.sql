-- Support soft-delete style sync for CSV imports
alter table if exists imd.groups
  add column if not exists deleted_at timestamptz,
  add column if not exists last_seen_at timestamptz;

-- Extend status enum-like check to include inactive
alter table if exists imd.groups
  drop constraint if exists groups_status_check;

alter table if exists imd.groups
  add constraint groups_status_check
  check (status in ('active', 'inactive', 'hiatus', 'disbanded'));

-- Backfill to keep active rows queryable right away
update imd.groups
set last_seen_at = coalesce(last_seen_at, updated_at, created_at)
where status = 'active';

create index if not exists groups_status_idx on imd.groups (status);
create index if not exists groups_last_seen_at_idx on imd.groups (last_seen_at desc);
