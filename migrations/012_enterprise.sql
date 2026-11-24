ALTER TABLE users DROP CONSTRAINT users_plan_check;
ALTER TABLE users ADD CONSTRAINT users_plan_check CHECK(plan IN ('free','pro','enterprise'));
ALTER TABLE upgrade_requests ADD COLUMN target_plan text NOT NULL DEFAULT 'pro' CHECK(target_plan IN ('pro','enterprise'));
CREATE TABLE enterprise_batches (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),request_key uuid NOT NULL,input_hash text NOT NULL,
 title text NOT NULL,input_count integer NOT NULL,rejected jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,request_key),UNIQUE(id,user_id)
);
CREATE TABLE enterprise_listings (
 id uuid PRIMARY KEY,batch_id uuid NOT NULL,user_id uuid NOT NULL,product_id text NOT NULL,input_urls jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','partial','failed','paused','cancelled')),
 data jsonb,error text,attempts integer NOT NULL DEFAULT 0,next_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(batch_id,user_id) REFERENCES enterprise_batches(id,user_id),UNIQUE(batch_id,product_id),UNIQUE(id,batch_id,user_id)
);
CREATE TABLE enterprise_snapshots (
 id uuid PRIMARY KEY,batch_id uuid NOT NULL,user_id uuid NOT NULL,document jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(batch_id,user_id) REFERENCES enterprise_batches(id,user_id),UNIQUE(id,batch_id,user_id)
);
CREATE TABLE enterprise_tasks (
 id uuid PRIMARY KEY,batch_id uuid NOT NULL,user_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('collect','report','chat')),
 listing_id uuid,snapshot_id uuid,conversation_id uuid,request_key uuid NOT NULL,ordinal integer,question text,focus jsonb,
 input jsonb NOT NULL,config jsonb NOT NULL,state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0,provider_requests integer NOT NULL DEFAULT 0,model_cursor integer NOT NULL DEFAULT 0,
 next_at timestamptz NOT NULL DEFAULT now(),lease_token uuid,lease_until timestamptz,actual_model text,result jsonb,usage jsonb,error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(batch_id,user_id) REFERENCES enterprise_batches(id,user_id),
 FOREIGN KEY(listing_id,batch_id,user_id) REFERENCES enterprise_listings(id,batch_id,user_id),
 FOREIGN KEY(snapshot_id,batch_id,user_id) REFERENCES enterprise_snapshots(id,batch_id,user_id),
 CHECK((kind='collect' AND listing_id IS NOT NULL AND snapshot_id IS NULL AND conversation_id IS NULL) OR (kind='report' AND snapshot_id IS NOT NULL AND conversation_id IS NULL) OR (kind='chat' AND snapshot_id IS NOT NULL AND conversation_id IS NOT NULL AND question IS NOT NULL AND ordinal>0)),
 UNIQUE(user_id,request_key),UNIQUE(id,batch_id,user_id)
);
CREATE TABLE enterprise_conversations (
 id uuid PRIMARY KEY,batch_id uuid NOT NULL,user_id uuid NOT NULL,snapshot_id uuid NOT NULL,report_task_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(snapshot_id,batch_id,user_id) REFERENCES enterprise_snapshots(id,batch_id,user_id),
 FOREIGN KEY(report_task_id,batch_id,user_id) REFERENCES enterprise_tasks(id,batch_id,user_id),UNIQUE(id,batch_id,user_id)
);
ALTER TABLE enterprise_tasks ADD FOREIGN KEY(conversation_id,batch_id,user_id) REFERENCES enterprise_conversations(id,batch_id,user_id);
CREATE UNIQUE INDEX enterprise_active_listing ON enterprise_tasks(listing_id) WHERE kind='collect' AND state IN ('pending','running');
CREATE UNIQUE INDEX enterprise_active_report ON enterprise_tasks(batch_id) WHERE kind='report' AND state IN ('pending','running');
CREATE UNIQUE INDEX enterprise_active_chat ON enterprise_tasks(conversation_id) WHERE kind='chat' AND state IN ('pending','running');
CREATE UNIQUE INDEX enterprise_chat_order ON enterprise_tasks(conversation_id,ordinal) WHERE kind='chat';
CREATE INDEX enterprise_queue ON enterprise_tasks(kind,state,next_at);
CREATE INDEX enterprise_owner ON enterprise_batches(user_id,created_at DESC);
CREATE TABLE enterprise_attempts (
 id bigserial PRIMARY KEY,task_id uuid NOT NULL REFERENCES enterprise_tasks(id),model text,endpoint_host text,usage jsonb,error text,
 started_at timestamptz NOT NULL DEFAULT now(),ended_at timestamptz
);
CREATE TABLE enterprise_model_cooldowns(model_key text PRIMARY KEY,until_at timestamptz NOT NULL,reason text NOT NULL);
CREATE FUNCTION enterprise_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='enterprise_snapshots' THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Immutable Enterprise snapshot'; END IF;
 ELSIF NEW.input IS DISTINCT FROM OLD.input OR NEW.config IS DISTINCT FROM OLD.config OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.batch_id IS DISTINCT FROM OLD.batch_id OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.snapshot_id IS DISTINCT FROM OLD.snapshot_id OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.question IS DISTINCT FROM OLD.question OR NEW.focus IS DISTINCT FROM OLD.focus OR NEW.listing_id IS DISTINCT FROM OLD.listing_id OR NEW.request_key IS DISTINCT FROM OLD.request_key OR NEW.ordinal IS DISTINCT FROM OLD.ordinal THEN
  RAISE EXCEPTION 'Immutable Enterprise request';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER enterprise_snapshot_immutable BEFORE UPDATE ON enterprise_snapshots FOR EACH ROW EXECUTE FUNCTION enterprise_immutable();
CREATE TRIGGER enterprise_request_immutable BEFORE UPDATE ON enterprise_tasks FOR EACH ROW EXECUTE FUNCTION enterprise_immutable();

ALTER TABLE enterprise_tasks ADD UNIQUE(id,snapshot_id,batch_id,user_id);
ALTER TABLE enterprise_conversations ADD FOREIGN KEY(report_task_id,snapshot_id,batch_id,user_id) REFERENCES enterprise_tasks(id,snapshot_id,batch_id,user_id);
ALTER TABLE enterprise_conversations ADD UNIQUE(id,snapshot_id,batch_id,user_id);
ALTER TABLE enterprise_tasks ADD FOREIGN KEY(conversation_id,snapshot_id,batch_id,user_id) REFERENCES enterprise_conversations(id,snapshot_id,batch_id,user_id);
