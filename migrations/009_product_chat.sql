-- Separate queue/protocol: report workers cannot claim chat work.
CREATE TABLE ai_chat_conversations (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES ai_jobs ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES saved_runs ON DELETE CASCADE,
 input_hash text NOT NULL, report_hash text NOT NULL, report_context jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,job_id,input_hash,report_hash)
);
-- One row is an ordered user message and its optional assistant response.
-- Retain failed/cancelled user messages as well as every successful response.
CREATE TABLE ai_chat_requests (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES ai_chat_conversations ON DELETE CASCADE,
 ordinal integer NOT NULL CHECK(ordinal>0), question text NOT NULL,
 use_images boolean NOT NULL DEFAULT false, config jsonb NOT NULL,
 protocol text NOT NULL DEFAULT 'product-chat-v1' CHECK(protocol='product-chat-v1'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','failed','cancelled')),
 result jsonb, scope jsonb, error text, actual_model text, usage jsonb,
 lease_token uuid, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,ordinal)
);
CREATE UNIQUE INDEX ai_chat_one_active ON ai_chat_requests(conversation_id) WHERE state IN ('pending','running');
CREATE INDEX ai_chat_queue ON ai_chat_requests(state,created_at);
CREATE INDEX ai_chat_owner ON ai_chat_conversations(user_id,created_at);
CREATE TABLE ai_chat_attempts (
 id bigserial PRIMARY KEY, request_id uuid NOT NULL REFERENCES ai_chat_requests ON DELETE CASCADE,
 model text NOT NULL, endpoint_host text NOT NULL, usage jsonb, error text,
 started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz
);
-- Chat fallback cannot consume or change report cooldown/retry state.
CREATE TABLE ai_chat_model_cooldowns (
 model_key text PRIMARY KEY CHECK(model_key ~ '^[a-f0-9]{64}$'),
 until_at timestamptz NOT NULL,
 reason text NOT NULL CHECK(reason IN ('free_quota_exhausted','credit_exhausted','model_permission_denied','model_unavailable'))
);
