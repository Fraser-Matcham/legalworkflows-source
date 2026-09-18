# Failed migration

Migrations in `backend/migrations/` run *before* the new backend starts
(`docs/deployment.md`, "Database setup"; ticket 2051's ordering: migrate,
then backend, then frontend). The backend itself only reads the schema on
start. So a failed migration presents in one of two ways:

- **In the deploy workflow**, as a failed migration step. Nothing was
  deployed; the old code is running against a schema that is partly new.
- **After the fact**, as a backend that started and errors on one feature
  (`backend-5xx` on a few routes) because a column or function it expects is
  missing. Someone deployed without migrating.

## 1. Find out what ran

Every migration is a file `YYYYMMDD_NN_<name>.sql`. The deployment record
(the deploy workflow's log, or the runbook note from a manual run) says
which was last applied. Confirm against the database — a migration's own
objects are the evidence:

```sql
-- example: does the object the latest migration creates exist?
select to_regclass('public.<table_or_index_from_the_migration>');
```

## 2. Read the error

Postgres names the statement. The usual causes:

| Error | Cause | Fix |
| --- | --- | --- |
| `already exists` | the migration, or part of it, ran before | migrations are written to be re-runnable (`if not exists`, `create or replace`, drop-before-create — AGENTS.md). If this one is not, the statement can be skipped: run the rest of the file from the next statement |
| `does not exist` (a column, table, function) | an earlier migration was skipped | apply the skipped one first, in filename order |
| `permission denied` / `must be owner` | wrong role | run as the `postgres` role in the SQL editor, which is what the workflow uses |
| a `check` constraint or `not null` violated by existing rows | production data the migration did not anticipate | **stop.** Do not "fix" the data to make the migration pass. Fix the migration to handle the data (a guarded backfill), test it against a copy — [restore.md](restore.md) says how to get one — and re-run |
| lock timeout | a long transaction holds the table | wait; find it with `select * from pg_stat_activity where state <> 'idle'` |

## 3. Re-run, forward

Fix the migration if it needed fixing, merge, and re-run the deploy. The
schema-drift CI check (`.github/workflows/schema-drift.yml`) proves that
`schema.sql` and the migration path agree before merge; a migration that
passed that check and failed in production met production data, and that
is what step 2's last row is about.

## 4. If data was damaged

A migration that transformed data wrongly is the one case for a database
restore to the backup taken before the deploy: [restore.md](restore.md).
**On the Free plan there is no such backup at all** — see the warning at the
top of [restore.md](restore.md). Recovering damaged data therefore means
reconstructing it by hand from the application's audit trail, if it can be
reconstructed at all. Once the org is on Pro, the daily backup is the point in
time you have unless point-in-time recovery has been enabled, which is why the
deploy should run at a quiet hour soon after it.

## Never

Never run `backend/schema.sql` against the production database. It is the
fresh-install shape, and it will not converge an existing database — it
will try to create everything and either fail or, worse, partly succeed.
