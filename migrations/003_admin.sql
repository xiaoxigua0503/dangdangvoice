ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin'));
ALTER TABLE users ADD COLUMN disabled_at timestamptz;
ALTER TABLE users ADD COLUMN pro_expires_at timestamptz;
CREATE UNIQUE INDEX users_one_admin ON users(role) WHERE role='admin';
ALTER TABLE users ADD CONSTRAINT admin_enabled CHECK(role<>'admin' OR disabled_at IS NULL);
CREATE TABLE upgrade_requests (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz, reviewed_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX upgrade_pending ON upgrade_requests(user_id) WHERE state='pending';
CREATE INDEX upgrade_order ON upgrade_requests(state,created_at DESC);
CREATE TABLE admin_audit (
 id bigserial PRIMARY KEY, actor_id uuid REFERENCES users(id), target_id uuid REFERENCES users(id),
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_admin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.role='admin' AND (TG_OP='DELETE' OR NEW.role<>'admin') THEN
 RAISE EXCEPTION 'The sole administrator cannot be removed'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER protect_admin BEFORE DELETE OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION protect_admin();
