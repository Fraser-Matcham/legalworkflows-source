-- Role bootstrap for the self-hosted platform (ticket 2112).
--
-- Run ONCE, as the master user, after the first apply of the database module
-- and before anything is restored into the instance or any service starts:
--
--   psql "$MASTER_URI" -v ON_ERROR_STOP=1 \
--        -v authenticator_password="$AUTHENTICATOR_PASSWORD" \
--        -v auth_admin_password="$AUTH_ADMIN_PASSWORD" \
--        -f bootstrap.sql
--
-- where the two passwords come from the <prefix>/database/roles secret and
-- MASTER_URI from the RDS-managed master secret (README, "Bootstrapping").
-- Every statement is idempotent, so re-running it after a password rotation
-- is the rotation procedure.
--
-- What it recreates is the role shape the Supabase image ships with, which a
-- plain PostgreSQL has none of. The names are not negotiable: schema.sql
-- grants to service_role by name, GoTrue connects as supabase_auth_admin, and
-- PostgREST switches from authenticator to the role a JWT names.
--
--   anon, authenticated, service_role   the three JWT roles. NOLOGIN: they are
--                                       only ever reached by SET ROLE from
--                                       authenticator.
--   authenticator                       PostgREST's connection role. NOINHERIT,
--                                       so it holds none of the three roles'
--                                       privileges until it switches.
--   supabase_auth_admin                 GoTrue's connection role; owns the auth
--                                       schema and everything GoTrue creates
--                                       in it.
--   supabase_admin, dashboard_user      NOLOGIN placeholders. Some of GoTrue's
--   and the other Supabase roles        own migrations grant to them by name,
--                                       and a dump of the Supabase database
--                                       carries GRANTs to the rest; a grant to
--                                       a missing role fails the restore.
--
-- It also creates the `extensions` schema Supabase keeps its extensions in
-- and installs the three schema.sql needs there, with the database's
-- search_path extended to find them. A dump of the Supabase database names
-- `extensions.gin_trgm_ops` in its index definitions, so a restore needs the
-- extension under that name; a fresh install's `create extension if not
-- exists` in schema.sql is then a no-op.

\set ON_ERROR_STOP on

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dashboard_user') then
    create role dashboard_user nologin noinherit;
  end if;
  -- The rest of the Supabase image's roles, so a dump's GRANTs resolve.
  if not exists (select 1 from pg_roles where rolname = 'supabase_read_only_user') then
    create role supabase_read_only_user nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_replication_admin') then
    create role supabase_replication_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_functions_admin') then
    create role supabase_functions_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_realtime_admin') then
    create role supabase_realtime_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'pgbouncer') then
    create role pgbouncer nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'pgsodium_keyholder') then
    create role pgsodium_keyholder nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'pgsodium_keyiduser') then
    create role pgsodium_keyiduser nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'pgsodium_keymaker') then
    create role pgsodium_keymaker nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
end
$$;

-- Passwords: set on every run, which is what makes this the rotation step.
alter role authenticator with login noinherit password :'authenticator_password';
alter role supabase_auth_admin with login noinherit createrole password :'auth_admin_password';

-- PostgREST: authenticator may become any of the three JWT roles.
grant anon, authenticated, service_role to authenticator;

-- On Supabase, service_role carries BYPASSRLS, which is how the backend's
-- queries pass the deny-all row-level security on thirty tables. PostgreSQL
-- lets only a real superuser confer BYPASSRLS, and the RDS master user is
-- rds_superuser, not superuser. Try it; if RDS refuses, say so and continue.
-- The fallback is a per-table policy for service_role, shipped as a
-- migration with the PostgREST service (ticket 2115) — see the README,
-- "Row-level security on RDS".
do $$
begin
  alter role service_role with bypassrls;
  raise notice 'service_role: BYPASSRLS set';
exception when insufficient_privilege then
  raise notice 'service_role: this server refuses BYPASSRLS for a non-superuser; the service_role policies migration is required (README, "Row-level security on RDS")';
end
$$;

-- The master user must be able to own, alter and restore objects in the auth
-- schema (pg_dump emits OWNER TO supabase_auth_admin for every table there,
-- and schema.sql creates triggers on auth.users). Membership is how a
-- non-superuser gets that.
grant supabase_auth_admin to postgres;

-- The auth schema exists from here so its privileges can be declared before
-- GoTrue's first migration creates the tables. GoTrue's own
-- `create schema if not exists auth` is then a no-op.
create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to postgres, anon, authenticated, service_role;
grant all on all tables in schema auth to postgres;
grant all on all sequences in schema auth to postgres;
grant all on all routines in schema auth to postgres;
alter default privileges for role supabase_auth_admin in schema auth grant all on tables to postgres;
alter default privileges for role supabase_auth_admin in schema auth grant all on sequences to postgres;
alter default privileges for role supabase_auth_admin in schema auth grant all on routines to postgres;

-- The public schema: schema.sql grants service_role what it needs on every
-- table it creates; the three roles need to be able to see the schema first.
grant usage on schema public to anon, authenticated, service_role;

-- Extensions, in the schema Supabase keeps them in so a dump restores by the
-- same names. All four are on RDS's supported list for PostgreSQL 17. The
-- database's search_path finds them for every session, as Supabase's does;
-- PostgREST is told the same through PGRST_DB_EXTRA_SEARCH_PATH.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role, supabase_auth_admin;
create extension if not exists pgcrypto schema extensions;
create extension if not exists pg_trgm schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists pg_stat_statements schema extensions;
alter database postgres set search_path = "$user", public, extensions;

-- What the next steps rely on, printed so the operator sees it.
select rolname, rolcanlogin, rolinherit, rolcreaterole, rolbypassrls
from pg_roles
where rolname in ('anon', 'authenticated', 'service_role', 'authenticator',
                  'supabase_auth_admin', 'supabase_admin', 'dashboard_user',
                  'supabase_read_only_user', 'supabase_replication_admin',
                  'supabase_storage_admin', 'supabase_functions_admin',
                  'supabase_realtime_admin', 'pgbouncer',
                  'pgsodium_keyholder', 'pgsodium_keyiduser', 'pgsodium_keymaker')
order by rolname;
