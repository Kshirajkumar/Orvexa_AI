-- Ensure every current client relationship is removed with the client.
-- Run after all schema migrations that create client_id foreign keys.
-- Safe to run repeatedly; it preserves constraint names and changes the
-- delete action to CASCADE.

DO $$
DECLARE
  fk RECORD;
  child_columns TEXT;
  parent_columns TEXT;
BEGIN
  FOR fk IN
    SELECT
      c.oid AS constraint_oid,
      c.conname,
      child_ns.nspname AS child_schema,
      child.relname AS child_table,
      c.conrelid,
      c.conkey,
      c.confkey
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.clients'::regclass
      AND child_ns.nspname = 'public'
  LOOP
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY cols.ordinality)
      INTO child_columns
    FROM unnest(fk.conkey) WITH ORDINALITY AS cols(attnum, ordinality)
    JOIN pg_attribute a
      ON a.attrelid = fk.conrelid AND a.attnum = cols.attnum;

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY cols.ordinality)
      INTO parent_columns
    FROM unnest(fk.confkey) WITH ORDINALITY AS cols(attnum, ordinality)
    JOIN pg_attribute a
      ON a.attrelid = 'public.clients'::regclass AND a.attnum = cols.attnum;

    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', fk.child_schema, fk.child_table, fk.conname);
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.clients (%s) ON DELETE CASCADE',
      fk.child_schema, fk.child_table, fk.conname, child_columns, parent_columns
    );
  END LOOP;
END $$;
