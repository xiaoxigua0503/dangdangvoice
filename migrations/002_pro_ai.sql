ALTER TABLE users ADD COLUMN plan text NOT NULL DEFAULT 'free' CHECK(plan IN ('free','pro'));
CREATE TABLE ai_jobs (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES saved_runs ON DELETE CASCADE,
 input_hash text NOT NULL, config jsonb NOT NULL, config_hash text NOT NULL,
 product jsonb NOT NULL, state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','completed','cancelled')),
 report jsonb, revision integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,run_id,input_hash,config_hash)
);
CREATE INDEX ai_jobs_owner ON ai_jobs(user_id,created_at DESC);
CREATE TABLE ai_comments (
 job_id uuid NOT NULL REFERENCES ai_jobs ON DELETE CASCADE, id text NOT NULL,
 source_id text, data jsonb NOT NULL, PRIMARY KEY(job_id,id)
);
CREATE TABLE ai_images (
 job_id uuid NOT NULL REFERENCES ai_jobs ON DELETE CASCADE, id text NOT NULL,
 url text NOT NULL, content_hash text, bytes bytea, mime text, downloaded_at timestamptz,
 error text, PRIMARY KEY(job_id,id), UNIQUE(job_id,url)
);
CREATE TABLE ai_image_comments (
 job_id uuid NOT NULL, image_id text NOT NULL, comment_id text NOT NULL,
 PRIMARY KEY(job_id,image_id,comment_id),
 FOREIGN KEY(job_id,image_id) REFERENCES ai_images(job_id,id) ON DELETE CASCADE,
 FOREIGN KEY(job_id,comment_id) REFERENCES ai_comments(job_id,id) ON DELETE CASCADE
);
CREATE TABLE ai_units (
 id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES ai_jobs ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('text','image')), input jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0, next_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid, lease_until timestamptz, result jsonb, error text,
 UNIQUE(job_id,id)
);
CREATE INDEX ai_units_queue ON ai_units(state,next_at,lease_until);
CREATE INDEX ai_units_job ON ai_units(job_id);
CREATE TABLE ai_attempts (
 id bigserial PRIMARY KEY, unit_id uuid NOT NULL REFERENCES ai_units ON DELETE CASCADE,
 started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, state text NOT NULL DEFAULT 'running',
 usage jsonb, error text, cached boolean NOT NULL DEFAULT false
);
CREATE TABLE ai_cache (
 user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, job_id uuid NOT NULL REFERENCES ai_jobs ON DELETE CASCADE,
 key text NOT NULL, result jsonb NOT NULL, usage jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,job_id,key)
);
CREATE TABLE ai_runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 global_concurrency integer NOT NULL DEFAULT 2 CHECK(global_concurrency BETWEEN 1 AND 8),
 user_concurrency integer NOT NULL DEFAULT 1 CHECK(user_concurrency BETWEEN 1 AND 4)
);
INSERT INTO ai_runtime(singleton) VALUES(true);
CREATE TABLE ai_unit_comments (
 job_id uuid NOT NULL, unit_id uuid NOT NULL, comment_id text NOT NULL,
 PRIMARY KEY(unit_id,comment_id),
 FOREIGN KEY(job_id,unit_id) REFERENCES ai_units(job_id,id) ON DELETE CASCADE,
 FOREIGN KEY(job_id,comment_id) REFERENCES ai_comments(job_id,id) ON DELETE CASCADE
);
CREATE INDEX ai_unit_comments_comment ON ai_unit_comments(job_id,comment_id);
CREATE INDEX ai_unit_image ON ai_units(job_id,(input->>'imageId')) WHERE kind='image';
