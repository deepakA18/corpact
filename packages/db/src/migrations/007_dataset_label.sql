-- What this database holds. No row means real chain history. The synthetic demo labels its own database;
-- the API stamps the label on every response and export, so demo data cannot pass for real data.
-- Append-only: once labelled synthetic, a database cannot be relabelled or unlabelled.

CREATE TABLE dataset_label (
  singleton   boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  kind        text NOT NULL CHECK (kind IN ('synthetic')),
  description text NOT NULL,
  labelled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER dataset_label_append_only BEFORE UPDATE OR DELETE ON dataset_label
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
