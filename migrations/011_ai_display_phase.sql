-- Observability only. No report/input/account/queue or budget changes.
ALTER TABLE ai_units ADD COLUMN display_phase text CHECK(display_phase IN ('prepare','model','persist'));
ALTER TABLE ai_units ADD COLUMN display_phase_at timestamptz;
-- Short owner/product coordination leases; collection still runs in the browser.
CREATE TABLE collection_leases (
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,pid text NOT NULL,
 token uuid NOT NULL,status text NOT NULL CHECK(status IN ('active','stopped','completed')),
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,pid)
);
