# IMDB Supabase Repository

This repository tracks the schema and operational assets for the idol master database (IMDB) that lives inside the Supabase project **supabase-buzzttara**. Use it as the single source of truth for schema, policies, seeds, and operational docs shared across the other idol-related apps.

## Repository Goals
- Version the database schema and row-level security (RLS) policies as code
- Provide reproducible migrations/seeds so any environment can recreate the IMDB state
- Document operational procedures: linking to supabase-buzzttara, branching, releases, and access control

## Prerequisites
- [Supabase CLI](https://supabase.com/docs/guides/cli) v1.150 or later
- Access to the Supabase project `supabase-buzzttara` (owner/editor role)
- Git + GitHub account where this repo will live (suggested name: `imdb-supabase`)

## Initial Setup
1. Clone this repository and "cd" into it.
2. Install the Supabase CLI if you have not already.
3. Authenticate once locally: `supabase login` (uses personal access token stored outside the repo).
4. Link this repo to the existing Supabase project:
   ```bash
   supabase link --project-ref supabase-buzzttara
   ```
   This command creates/updates `supabase/config.toml` (already gitignored) so local commands target the production project.
5. Pull the current database definition so you start from reality:
   ```bash
   supabase db pull
   ```
   The CLI will place migrations inside `supabase/migrations` and generate a schema snapshot if configured.

## Working With The Schema
- Keep raw SQL artifacts in `schema/`. Example layout:
  - `schema/tables.sql` → core tables (idols, groups, activities, social links)
  - `schema/policies.sql` → RLS policies and helper roles
  - `schema/seeds/` → deterministic seed data for dev/testing
- Use Supabase migrations for every schema change:
  ```bash
  supabase migration new add-idol-groups
  # edit the generated SQL
  supabase db push   # apply locally
  supabase db diff --file schema/latest.sql   # optional snapshot
  ```
- After validating locally, run `supabase db push --linked` to apply the change to supabase-buzzttara (or use the dashboard SQL editor for hotfixes and mirror them back via `supabase db pull`).

## Branching & Release Guidelines
- Default branch `main` mirrors production (supabase-buzzttara).
- For work, create feature branches (e.g., `feature/add-activities-table`).
- Open PRs for schema/policy changes so they are reviewed before merging.
- Tag releases (`v2024.05.01`) to indicate synchronized states with Supabase, especially before/after major data loads.

## Access & Security Notes
- Only trusted maintainers should have write access; apps consume the database in read-only mode via RLS policies.
- No secrets or access tokens should be committed. CLI credentials live in `~/.supabase/`. Environment-specific values belong in `.env` (ignored by git).
- Document breaking data migrations and seed scripts clearly to avoid accidental destructive deploys.

## Next Steps
1. Capture the current schema (`supabase db pull`) and commit the generated migrations.
2. Draft the ERD/SQL files inside `schema/` to describe each entity (idol, group, activity, SNS, etc.).
3. Define initial RLS policies ensuring only admins can mutate data; apps remain read-only.
4. Automate verification (optional): integrate GitHub Actions to run linting or `supabase db lint` (when available).

This repo becomes the coordination hub for every app that depends on the IMDB. Keep the documentation and migrations in sync with Supabase so the master data stays trustworthy.
