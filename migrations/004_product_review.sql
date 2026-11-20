-- Additive: legacy units, reports, snapshots and private caches remain intact.
ALTER TABLE ai_units DROP CONSTRAINT ai_units_kind_check;
ALTER TABLE ai_units ADD CONSTRAINT ai_units_kind_check CHECK(kind IN ('text','image','prepare','review','synthesis'));
CREATE UNIQUE INDEX ai_one_synthesis ON ai_units(job_id) WHERE kind='synthesis';
