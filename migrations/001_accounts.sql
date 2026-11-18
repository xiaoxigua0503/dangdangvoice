CREATE TABLE users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
 verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(email = lower(email))
);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE email_tokens (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('verify','reset')), expires_at timestamptz NOT NULL
);
CREATE INDEX email_tokens_user ON email_tokens(user_id);
CREATE TABLE auth_limits (
 key text PRIMARY KEY, hits integer NOT NULL, until_at timestamptz NOT NULL
);
CREATE TABLE saved_runs (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 idempotency_key uuid NOT NULL, product jsonb NOT NULL, engine_version text NOT NULL,
 schema_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,idempotency_key)
);
CREATE INDEX saved_runs_owner ON saved_runs(user_id,created_at DESC);
CREATE TABLE saved_comments (
 run_id uuid NOT NULL REFERENCES saved_runs ON DELETE CASCADE,
 ordinal integer NOT NULL, data jsonb NOT NULL, PRIMARY KEY(run_id,ordinal)
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX email_tokens_expiry ON email_tokens(expires_at);
CREATE INDEX auth_limits_expiry ON auth_limits(until_at);
ALTER TABLE sessions ADD CHECK (token_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE email_tokens ADD CHECK (token_hash ~ '^[a-f0-9]{64}$');
ALTER TABLE saved_runs ADD CHECK (jsonb_typeof(product)='object');
ALTER TABLE saved_comments ADD CHECK (jsonb_typeof(data)='object');
