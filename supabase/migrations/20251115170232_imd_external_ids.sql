-- IMDB external IDs for idol groups
create table if not exists imd.external_ids (
  id bigserial primary key,
  group_id uuid not null references imd.groups(id) on delete cascade,
  service text not null,
  external_id text, -- Spotify Artist ID, YouTube Channel ID, @handle など
  url text,         -- 人間がアクセスするURL（あれば）
  meta jsonb,
  created_at timestamptz not null default now(),
  unique (group_id, service)
);

-- よく使いそうな検索用インデックス
create index if not exists external_ids_service_external_id_idx
  on imd.external_ids (service, external_id);

create index if not exists external_ids_group_id_idx
  on imd.external_ids (group_id);
