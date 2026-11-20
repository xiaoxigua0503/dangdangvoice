-- Old processes do not advertise the v2 protocol. A SQL WHERE in new code alone
-- cannot prevent an already-running old binary from claiming a new pipeline.
CREATE FUNCTION ddv_ai_claim_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cfg jsonb; capabilities jsonb; pipeline text; schema_version integer;
BEGIN
  IF NEW.state <> 'running' OR (OLD.state = 'running' AND OLD.lease_token IS NOT DISTINCT FROM NEW.lease_token) THEN
    RETURN NEW;
  END IF;
  SELECT config INTO cfg FROM ai_jobs WHERE id=NEW.job_id;
  schema_version := (cfg->>'schemaVersion')::integer;
  pipeline := coalesce(cfg->>'pipelineVersion', CASE schema_version WHEN 1 THEN 'evidence-v1' WHEN 2 THEN 'product-review-v2' END);
  -- Existing v1 workers may finish v1 jobs. No backward permission for v2.
  IF schema_version=1 AND pipeline='evidence-v1' AND NEW.kind IN ('text','image') THEN RETURN NEW; END IF;
  capabilities := coalesce(nullif(current_setting('ddv.ai_worker_capabilities',true),''),'{}')::jsonb;
  IF pipeline IS NULL OR capabilities->pipeline IS NULL
     OR (capabilities->pipeline->>'schema')::integer IS DISTINCT FROM schema_version
     OR NOT coalesce((capabilities->pipeline->'kinds') ? NEW.kind,false) THEN
    RAISE EXCEPTION 'worker_pipeline_incompatible' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ai_claim_version_guard BEFORE UPDATE ON ai_units
FOR EACH ROW EXECUTE FUNCTION ddv_ai_claim_version_guard();

-- Rejected output remains private diagnostic evidence, never a completed report.
-- Attempts and immutable source inputs survive a bounded retry.
ALTER TABLE ai_attempts ADD COLUMN validation jsonb;
