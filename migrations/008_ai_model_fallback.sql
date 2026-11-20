-- Additive runtime state; existing immutable jobs, reports and caches untouched.
ALTER TABLE ai_jobs ADD COLUMN model_cursor integer NOT NULL DEFAULT 0 CHECK(model_cursor>=0);
CREATE TABLE ai_model_cooldowns (
 model_key text PRIMARY KEY CHECK(model_key ~ '^[a-f0-9]{64}$'),
 until_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(reason IN ('free_quota_exhausted','credit_exhausted','model_permission_denied','model_unavailable'))
);
