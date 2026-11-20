-- Additive: historical reports/configurations and immutable inputs are untouched.
ALTER TABLE ai_jobs DROP CONSTRAINT ai_jobs_state_check;
ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_state_check CHECK(state IN ('queued','running','completed','partial','failed','cancelled'));
ALTER TABLE ai_jobs ADD COLUMN provider_requests integer NOT NULL DEFAULT 0 CHECK(provider_requests>=0);
ALTER TABLE ai_attempts ADD COLUMN provider_request boolean NOT NULL DEFAULT false;
