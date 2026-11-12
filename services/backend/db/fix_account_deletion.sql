/*
  TaxFlow.AI - production account deletion foreign-key repair

  Why this exists:
  Supabase Auth deletes auth.users first. PostgreSQL then enforces every
  foreign key that references auth.users. Any FK left at the default
  NO ACTION makes Auth return:
    "Database error deleting user"

  Policy:
  - NOT NULL references are ownership references and cascade.
  - Nullable references are actor/audit references and are nulled, preserving
    the business row without retaining the deleted user's identity.

  This migration is idempotent and discovers constraints from the live catalog,
  so it also repairs older/manual tables that are not represented in the repo.
  It deliberately does not touch storage.objects: PostgreSQL cannot call the
  Supabase Storage API transactionally. Private Storage cleanup must remain in
  the backend account-deletion flow (or a separately configured Edge Function).
*/

BEGIN;

DO $$
DECLARE
  fk RECORD;
  child_column TEXT;
  child_is_not_null BOOLEAN;
  action_sql TEXT;
BEGIN
  FOR fk IN
    SELECT
      c.oid AS constraint_oid,
      c.conname,
      c.conrelid,
      child_ns.nspname AS child_schema,
      child.relname AS child_table,
      c.conkey
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND child_ns.nspname NOT IN ('pg_catalog', 'information_schema')
      AND c.confdeltype IN ('a', 'r', 'd') -- NO ACTION, RESTRICT, or SET DEFAULT
  LOOP
    IF array_length(fk.conkey, 1) <> 1 THEN
      RAISE EXCEPTION
        'Cannot automatically repair composite FK %.%.%',
        fk.child_schema, fk.child_table, fk.conname;
    END IF;

    SELECT a.attname, a.attnotnull
      INTO child_column, child_is_not_null
    FROM pg_attribute a
    WHERE a.attrelid = fk.conrelid
      AND a.attnum = fk.conkey[1]
      AND NOT a.attisdropped;

    IF child_column IS NULL THEN
      RAISE EXCEPTION 'Could not resolve child column for FK %.%.%',
        fk.child_schema, fk.child_table, fk.conname;
    END IF;

    action_sql := CASE
      WHEN child_is_not_null THEN 'ON DELETE CASCADE'
      ELSE 'ON DELETE SET NULL'
    END;

    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I',
      fk.child_schema, fk.child_table, fk.conname);
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) %s',
      fk.child_schema, fk.child_table, fk.conname, child_column, action_sql
    );
  END LOOP;
END $$;

-- Required indexes for the account-delete cascade and future user-scoped reads.
DO $$
DECLARE
  fk RECORD;
  child_column TEXT;
  index_name TEXT;
BEGIN
  FOR fk IN
    SELECT
      c.conrelid,
      c.conname,
      child_ns.nspname AS child_schema,
      child.relname AS child_table,
      c.conkey
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE c.contype = 'f'
      AND c.confrelid = 'auth.users'::regclass
      AND array_length(c.conkey, 1) = 1
      AND child_ns.nspname = 'public'
  LOOP
    SELECT a.attname INTO child_column
    FROM pg_attribute a
    WHERE a.attrelid = fk.conrelid
      AND a.attnum = fk.conkey[1]
      AND NOT a.attisdropped;

    index_name := left('idx_' || fk.child_table || '_' || child_column || '_account_delete', 63);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I)',
      index_name, fk.child_schema, fk.child_table, child_column);
  END LOOP;
END $$;

-- Fail the migration if an auth.users FK still blocks account deletion.
DO $$
DECLARE
  blocking_count INTEGER;
BEGIN
  SELECT count(*) INTO blocking_count
  FROM pg_constraint c
  JOIN pg_class child ON child.oid = c.conrelid
  JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
  WHERE c.contype = 'f'
    AND c.confrelid = 'auth.users'::regclass
    AND child_ns.nspname NOT IN ('pg_catalog', 'information_schema')
    AND c.confdeltype IN ('a', 'r', 'd');

  IF blocking_count > 0 THEN
    RAISE EXCEPTION 'Account deletion still has % blocking auth.users foreign key(s)', blocking_count;
  END IF;
END $$;

COMMIT;

-- Verification: this should return zero rows after the migration.
SELECT
  child_ns.nspname AS child_schema,
  child.relname AS child_table,
  c.conname,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
JOIN pg_class child ON child.oid = c.conrelid
JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
WHERE c.contype = 'f'
  AND c.confrelid = 'auth.users'::regclass
  AND c.confdeltype IN ('a', 'r')
ORDER BY 1, 2, 3;
