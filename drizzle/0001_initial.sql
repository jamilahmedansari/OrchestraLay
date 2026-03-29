-- OrchestraLay — Drizzle initial migration
-- Generated from server/db/schema.ts
-- Run with: npm run db:migrate

-- ─── Enums ───────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "team_role" AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "task_type" AS ENUM (
    'code_generation', 'debugging', 'refactoring', 'analysis', 'review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "task_status" AS ENUM (
    'submitted', 'routing', 'executing', 'completed', 'failed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "diff_operation" AS ENUM ('create', 'modify', 'delete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "diff_status" AS ENUM (
    'pending', 'approved', 'rejected', 'blocked', 'applied', 'reverted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "model_result_status" AS ENUM ('success', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "users" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email"        varchar(320) NOT NULL,
  "display_name" varchar(120),
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"   timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE IF NOT EXISTS "teams" (
  "id"                          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"                        varchar(120) NOT NULL,
  "slug"                        varchar(120) NOT NULL,
  "plan"                        varchar(32) DEFAULT 'starter' NOT NULL,
  "monthly_budget_cents"        integer DEFAULT 0 NOT NULL,
  "current_month_spend_cents"   integer DEFAULT 0 NOT NULL,
  "trial_ends_at"               timestamp with time zone,
  "created_at"                  timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"                  timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "team_members" (
  "team_id"    uuid NOT NULL,
  "user_id"    uuid NOT NULL,
  "role"       "team_role" DEFAULT 'member' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "team_members_team_id_user_id_pk" PRIMARY KEY("team_id","user_id")
);

CREATE TABLE IF NOT EXISTS "projects" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id"              uuid NOT NULL,
  "name"                 varchar(120) NOT NULL,
  "slug"                 varchar(120) NOT NULL,
  "description"          text,
  "auto_apply_changes"   boolean DEFAULT false NOT NULL,
  "monthly_budget_cents" integer DEFAULT 0 NOT NULL,
  "safety_rules"         jsonb DEFAULT '{}' NOT NULL,
  "created_at"           timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"           timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "api_keys" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id"          uuid NOT NULL,
  "created_by_user_id"  uuid,
  "name"                varchar(120) NOT NULL,
  "key_hash"            varchar(64) NOT NULL,
  "scopes"              jsonb DEFAULT '[]'::jsonb NOT NULL,
  "revoked"             boolean DEFAULT false NOT NULL,
  "expires_at"          timestamp with time zone,
  "last_used_at"        timestamp with time zone,
  "created_at"          timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "rate_limit_buckets" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key_id"       uuid NOT NULL,
  "bucket_type"  varchar(32) NOT NULL,
  "window_start" timestamp with time zone NOT NULL,
  "count"        integer DEFAULT 0 NOT NULL,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tasks" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id"               uuid NOT NULL,
  "project_id"            uuid NOT NULL,
  "submitted_by_key_id"   uuid,
  "submitted_by_user_id"  uuid,
  "prompt"                text NOT NULL,
  "task_type"             "task_type" NOT NULL,
  "preferred_model"       varchar(64),
  "budget_cents"          integer DEFAULT 0 NOT NULL,
  "timeout_seconds"       integer DEFAULT 60 NOT NULL,
  "status"                "task_status" DEFAULT 'submitted' NOT NULL,
  "model_id"              varchar(64),
  "output_summary"        text,
  "total_cost_cents"      integer DEFAULT 0 NOT NULL,
  "error_message"         text,
  "routing_reasoning"     jsonb DEFAULT '[]'::jsonb NOT NULL,
  "metadata"              jsonb DEFAULT '{}' NOT NULL,
  "completed_at"          timestamp with time zone,
  "failed_at"             timestamp with time zone,
  "created_at"            timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"            timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "model_results" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id"       uuid NOT NULL,
  "model_id"      varchar(64) NOT NULL,
  "attempt"       integer DEFAULT 1 NOT NULL,
  "status"        "model_result_status" NOT NULL,
  "input_tokens"  integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "cost_cents"    integer DEFAULT 0 NOT NULL,
  "duration_ms"   integer DEFAULT 0 NOT NULL,
  "raw_response"  text,
  "error_message" text,
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "diffs" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id"              uuid NOT NULL,
  "project_id"           uuid NOT NULL,
  "model_result_id"      uuid NOT NULL,
  "operation"            "diff_operation" NOT NULL,
  "file_path"            text NOT NULL,
  "before_content"       text,
  "after_content"        text,
  "unified_diff"         text,
  "hunks"                jsonb DEFAULT '[]'::jsonb NOT NULL,
  "lines_added"          integer DEFAULT 0 NOT NULL,
  "lines_removed"        integer DEFAULT 0 NOT NULL,
  "status"               "diff_status" DEFAULT 'pending' NOT NULL,
  "flagged"              boolean DEFAULT false NOT NULL,
  "blocked"              boolean DEFAULT false NOT NULL,
  "safety_violations"    jsonb DEFAULT '[]'::jsonb NOT NULL,
  "approved_by_user_id"  uuid,
  "rejected_by_user_id"  uuid,
  "approved_at"          timestamp with time zone,
  "rejected_at"          timestamp with time zone,
  "applied_at"           timestamp with time zone,
  "reverted_at"          timestamp with time zone,
  "created_at"           timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "integrations" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "type"       varchar(48) NOT NULL,
  "enabled"    boolean DEFAULT true NOT NULL,
  "config"     jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "webhooks" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "url"        text NOT NULL,
  "secret"     text,
  "enabled"    boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "team_id"    uuid NOT NULL,
  "actor_id"   uuid,
  "action"     varchar(64) NOT NULL,
  "resource_type" varchar(64),
  "resource_id"   uuid,
  "metadata"   jsonb DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ─── Foreign keys ────────────────────────────────────────────────────────────

ALTER TABLE "team_members"
  ADD CONSTRAINT "team_members_team_id_teams_id_fk"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "team_members_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_team_id_teams_id_fk"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "rate_limit_buckets"
  ADD CONSTRAINT "rate_limit_buckets_key_id_api_keys_id_fk"
    FOREIGN KEY ("key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_team_id_teams_id_fk"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "tasks_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "tasks_submitted_by_key_id_api_keys_id_fk"
    FOREIGN KEY ("submitted_by_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "tasks_submitted_by_user_id_users_id_fk"
    FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "model_results"
  ADD CONSTRAINT "model_results_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE;

ALTER TABLE "diffs"
  ADD CONSTRAINT "diffs_task_id_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "diffs_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "diffs_model_result_id_model_results_id_fk"
    FOREIGN KEY ("model_result_id") REFERENCES "model_results"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "diffs_approved_by_user_id_users_id_fk"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "diffs_rejected_by_user_id_users_id_fk"
    FOREIGN KEY ("rejected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;

ALTER TABLE "integrations"
  ADD CONSTRAINT "integrations_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;

ALTER TABLE "webhooks"
  ADD CONSTRAINT "webhooks_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_team_id_teams_id_fk"
    FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "audit_logs_actor_id_users_id_fk"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL;

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "team_members_user_idx"            ON "team_members" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_idx"     ON "api_keys" ("key_hash");
CREATE INDEX IF NOT EXISTS "api_keys_project_idx"             ON "api_keys" ("project_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limit_buckets_key_window_idx"
  ON "rate_limit_buckets" ("key_id", "bucket_type", "window_start");
CREATE INDEX IF NOT EXISTS "tasks_team_status_idx"            ON "tasks" ("team_id", "status");
CREATE INDEX IF NOT EXISTS "tasks_project_created_idx"        ON "tasks" ("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "model_results_task_idx"           ON "model_results" ("task_id");
CREATE INDEX IF NOT EXISTS "diffs_task_idx"                   ON "diffs" ("task_id");
CREATE INDEX IF NOT EXISTS "diffs_project_idx"                ON "diffs" ("project_id");
CREATE INDEX IF NOT EXISTS "diffs_status_idx"                 ON "diffs" ("status");
CREATE INDEX IF NOT EXISTS "diffs_blocked_idx"                ON "diffs" ("blocked", "flagged");
CREATE INDEX IF NOT EXISTS "audit_logs_team_created_idx"      ON "audit_logs" ("team_id", "created_at");

-- ─── updated_at trigger ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','teams','projects','tasks','integrations','webhooks']
  LOOP
    EXECUTE format('
      DROP TRIGGER IF EXISTS trg_updated_at ON %I;
      CREATE TRIGGER trg_updated_at
        BEFORE UPDATE ON %I
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    ', t, t);
  END LOOP;
END $$;

-- ─── Drizzle meta (tells drizzle-kit this migration is applied) ──────────────
-- drizzle-kit tracks applied migrations via the __drizzle_migrations table.
-- The first time you run `npm run db:migrate` this file will be recorded there.
