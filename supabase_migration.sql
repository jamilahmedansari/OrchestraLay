-- ============================================================
-- OrchestraLay — Supabase Migration
-- Paste this entire file into the Supabase SQL Editor and run.
-- Safe to run multiple times (uses IF NOT EXISTS / DO blocks).
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Enums ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE team_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_type AS ENUM (
    'code_generation', 'debugging', 'refactoring', 'analysis', 'review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM (
    'submitted', 'routing', 'executing', 'completed', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE diff_operation AS ENUM ('create', 'modify', 'delete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE diff_status AS ENUM (
    'pending', 'approved', 'rejected', 'blocked', 'applied', 'reverted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE model_result_status AS ENUM ('success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── users ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       VARCHAR(320) NOT NULL UNIQUE,
  display_name VARCHAR(120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── teams ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      VARCHAR(120) NOT NULL,
  slug                      VARCHAR(120) NOT NULL UNIQUE,
  plan                      VARCHAR(32)  NOT NULL DEFAULT 'starter',
  monthly_budget_cents      INTEGER      NOT NULL DEFAULT 0,
  current_month_spend_cents INTEGER      NOT NULL DEFAULT 0,
  trial_ends_at             TIMESTAMPTZ,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── team_members ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  team_id    UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       team_role   NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON team_members(user_id);

-- ─── projects ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id             UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name                VARCHAR(120) NOT NULL,
  slug                VARCHAR(120) NOT NULL,
  description         TEXT,
  auto_apply_changes  BOOLEAN     NOT NULL DEFAULT FALSE,
  monthly_budget_cents INTEGER    NOT NULL DEFAULT 0,
  safety_rules        JSONB       NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_team_slug_idx ON projects(team_id, slug);

-- ─── api_keys ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by_user_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
  name                VARCHAR(120) NOT NULL,
  key_hash            VARCHAR(64) NOT NULL,
  scopes              JSONB       NOT NULL DEFAULT '[]',
  revoked             BOOLEAN     NOT NULL DEFAULT FALSE,
  expires_at          TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_project_idx ON api_keys(project_id);

-- ─── rate_limit_buckets ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id       UUID        NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  bucket_type  VARCHAR(32) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER     NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_buckets_key_window_idx
  ON rate_limit_buckets(key_id, bucket_type, window_start);

-- ─── tasks ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id              UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  project_id           UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  submitted_by_key_id  UUID        REFERENCES api_keys(id) ON DELETE SET NULL,
  submitted_by_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  prompt               TEXT        NOT NULL,
  task_type            task_type   NOT NULL,
  preferred_model      VARCHAR(64),
  budget_cents         INTEGER     NOT NULL DEFAULT 0,
  timeout_seconds      INTEGER     NOT NULL DEFAULT 60,
  status               task_status NOT NULL DEFAULT 'submitted',
  model_id             VARCHAR(64),
  output_summary       TEXT,
  total_cost_cents     INTEGER     NOT NULL DEFAULT 0,
  error_message        TEXT,
  routing_reasoning    JSONB       NOT NULL DEFAULT '[]',
  metadata             JSONB       NOT NULL DEFAULT '{}',
  completed_at         TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tasks_team_status_idx   ON tasks(team_id, status);
CREATE INDEX IF NOT EXISTS tasks_project_created_idx ON tasks(project_id, created_at);

-- ─── model_results ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_results (
  id            UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       UUID                NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  model_id      VARCHAR(64)         NOT NULL,
  attempt       INTEGER             NOT NULL DEFAULT 1,
  status        model_result_status NOT NULL,
  input_tokens  INTEGER             NOT NULL DEFAULT 0,
  output_tokens INTEGER             NOT NULL DEFAULT 0,
  cost_cents    INTEGER             NOT NULL DEFAULT 0,
  duration_ms   INTEGER             NOT NULL DEFAULT 0,
  raw_response  TEXT,
  error_message TEXT,
  created_at    TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS model_results_task_idx ON model_results(task_id);

-- ─── diffs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS diffs (
  id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id              UUID           NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id           UUID           NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_result_id      UUID           NOT NULL REFERENCES model_results(id) ON DELETE CASCADE,
  operation            diff_operation NOT NULL,
  file_path            TEXT           NOT NULL,
  before_content       TEXT,
  after_content        TEXT,
  unified_diff         TEXT,
  hunks                JSONB          NOT NULL DEFAULT '[]',
  lines_added          INTEGER        NOT NULL DEFAULT 0,
  lines_removed        INTEGER        NOT NULL DEFAULT 0,
  status               diff_status    NOT NULL DEFAULT 'pending',
  flagged              BOOLEAN        NOT NULL DEFAULT FALSE,
  blocked              BOOLEAN        NOT NULL DEFAULT FALSE,
  safety_violations    JSONB          NOT NULL DEFAULT '[]',
  approved_by_user_id  UUID           REFERENCES users(id) ON DELETE SET NULL,
  rejected_by_user_id  UUID           REFERENCES users(id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  rejected_at          TIMESTAMPTZ,
  applied_at           TIMESTAMPTZ,
  reverted_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS diffs_task_idx    ON diffs(task_id);
CREATE INDEX IF NOT EXISTS diffs_project_idx ON diffs(project_id);
CREATE INDEX IF NOT EXISTS diffs_status_idx  ON diffs(status);
CREATE INDEX IF NOT EXISTS diffs_blocked_idx ON diffs(blocked, flagged);

-- ─── integrations ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integrations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type       VARCHAR(48) NOT NULL,
  enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  config     JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── webhooks ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url        TEXT        NOT NULL,
  secret     TEXT,
  enabled    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── audit_logs ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    UUID        REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(64) NOT NULL,
  entity     VARCHAR(64),
  entity_id  UUID,
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_logs_team_idx ON audit_logs(team_id, created_at);

-- ─── updated_at trigger ──────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','teams','projects','integrations','webhooks','tasks']
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_set_updated_at ON %I;
      CREATE TRIGGER trg_set_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    ', t, t);
  END LOOP;
END $$;

-- ─── Atomic spend increment (used by budgetGuard) ────────────
-- Usage: SELECT increment_team_spend('<team_id>', <cents>);
CREATE OR REPLACE FUNCTION increment_team_spend(p_team_id UUID, p_cents INTEGER)
RETURNS INTEGER AS $$
DECLARE
  new_spend INTEGER;
BEGIN
  UPDATE teams
  SET current_month_spend_cents = current_month_spend_cents + p_cents
  WHERE id = p_team_id
  RETURNING current_month_spend_cents INTO new_spend;
  RETURN new_spend;
END;
$$ LANGUAGE plpgsql;

-- ─── Supabase Realtime ───────────────────────────────────────
-- Enable realtime on tasks table for live dashboard updates
ALTER TABLE tasks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;

-- ─── Row Level Security ──────────────────────────────────────
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects    ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE diffs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs  ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own profile
CREATE POLICY IF NOT EXISTS "users: own row" ON users
  FOR ALL USING (auth.uid() = id);

-- Team members can see their teams
CREATE POLICY IF NOT EXISTS "teams: member access" ON teams
  FOR SELECT USING (
    id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Team members can see other members of their teams
CREATE POLICY IF NOT EXISTS "team_members: member access" ON team_members
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Projects: visible to team members
CREATE POLICY IF NOT EXISTS "projects: team member access" ON projects
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- API keys: visible to team members
CREATE POLICY IF NOT EXISTS "api_keys: team member access" ON api_keys
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM projects WHERE team_id IN (
        SELECT team_id FROM team_members WHERE user_id = auth.uid()
      )
    )
  );

-- Tasks: visible to team members
CREATE POLICY IF NOT EXISTS "tasks: team member access" ON tasks
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM team_members WHERE user_id = auth.uid()
    )
  );

-- Model results: visible via task access
CREATE POLICY IF NOT EXISTS "model_results: team member access" ON model_results
  FOR SELECT USING (
    task_id IN (
      SELECT id FROM tasks WHERE team_id IN (
        SELECT team_id FROM team_members WHERE user_id = auth.uid()
      )
    )
  );

-- Diffs: visible to team members
CREATE POLICY IF NOT EXISTS "diffs: team member access" ON diffs
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM projects WHERE team_id IN (
        SELECT team_id FROM team_members WHERE user_id = auth.uid()
      )
    )
  );

-- Audit logs: visible to team admins/owners only
CREATE POLICY IF NOT EXISTS "audit_logs: admin access" ON audit_logs
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM team_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin')
    )
  );

-- ─── Done ────────────────────────────────────────────────────
-- All tables, indexes, enums, triggers, RLS policies created.
-- Next: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL in Railway.
