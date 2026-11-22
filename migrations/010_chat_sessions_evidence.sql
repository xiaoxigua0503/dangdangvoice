-- Preserve all legacy conversations/messages; add explicit sessions and inputs.
CREATE TABLE ai_chat_sessions (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES ai_chat_conversations ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(conversation_id,id)
);
INSERT INTO ai_chat_sessions(id,conversation_id,created_at)
 SELECT id,id,created_at FROM ai_chat_conversations;
ALTER TABLE ai_chat_requests ADD COLUMN session_id uuid;
UPDATE ai_chat_requests SET session_id=conversation_id;
ALTER TABLE ai_chat_requests ADD CONSTRAINT ai_chat_request_session
 FOREIGN KEY(conversation_id,session_id) REFERENCES ai_chat_sessions(conversation_id,id);
ALTER TABLE ai_chat_requests ADD COLUMN image_ids jsonb;
ALTER TABLE ai_chat_requests ADD COLUMN purpose text NOT NULL DEFAULT 'unspecified'
 CHECK(purpose IN ('unspecified','beginner','research','gift','collection'));
ALTER TABLE ai_chat_requests DROP CONSTRAINT ai_chat_requests_protocol_check;
ALTER TABLE ai_chat_requests ADD CONSTRAINT ai_chat_requests_protocol_check
 CHECK(protocol IN ('product-chat-v1','product-chat-v2'));
CREATE INDEX ai_chat_session_order ON ai_chat_requests(session_id,ordinal);
