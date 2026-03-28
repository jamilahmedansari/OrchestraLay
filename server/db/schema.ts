import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  varchar,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── users ───────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  supabaseUserId: text('supabase_user_id').notNull().unique(),
  email: text('email').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
}))

// ─── teams ───────────────────────────────────────────────────────────
export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  plan: varchar('plan', { length: 20 }).notNull().default('starter'),
  monthlyTokenLimit: integer('monthly_token_limit').notNull().default(500_000),
  monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(2900),
  currentMonthSpendCents: integer('current_month_spend_cents').notNull().default(0),
  billingPeriod: varchar('billing_period', { length: 7 }).notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const teamsRelations = relations(teams, ({ many }) => ({
  teamMembers: many(teamMembers),
  projects: many(projects),
  costLogs: many(costLogs),
  billingHistory: many(teamBillingHistory),
}))

// ─── team_members ────────────────────────────────────────────────────
export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 20 }).notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('team_members_user_team_idx').on(t.userId, t.teamId),
  ]
)

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
}))

// ─── projects ────────────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  autoApplyChanges: boolean('auto_apply_changes').notNull().default(false),
  safetyRules: jsonb('safety_rules').$type<{
    allowFileDeletion?: boolean
    allowFrameworkChanges?: boolean
    allowTestFileDeletion?: boolean
    customBlockedPaths?: string[]
  }>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const projectsRelations = relations(projects, ({ one, many }) => ({
  team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
  tasks: many(tasks),
  apiKeys: many(apiKeys),
  integrations: many(integrations),
  webhooks: many(webhooks),
}))

// ─── api_keys ────────────────────────────────────────────────────────
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default(['tasks:write']),
    revoked: boolean('revoked').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('api_keys_key_hash_idx').on(t.keyHash),
  ]
)

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  project: one(projects, { fields: [apiKeys.projectId], references: [projects.id] }),
  rateLimitBuckets: many(rateLimitBuckets),
}))

// ─── rate_limit_buckets ──────────────────────────────────────────────
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    keyId: uuid('key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    bucketType: varchar('bucket_type', { length: 20 }).notNull(),
    tokenCount: integer('token_count').notNull().default(0),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rate_limit_buckets_key_bucket_idx').on(t.keyId, t.bucketType),
  ]
)

export const rateLimitBucketsRelations = relations(rateLimitBuckets, ({ one }) => ({
  apiKey: one(apiKeys, { fields: [rateLimitBuckets.keyId], references: [apiKeys.id] }),
}))

// ─── tasks ───────────────────────────────────────────────────────────
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    taskType: varchar('task_type', { length: 30 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('submitted'),
    preferredModels: jsonb('preferred_models').$type<string[]>(),
    budgetCents: integer('budget_cents'),
    timeoutSeconds: integer('timeout_seconds').default(120),
    selectedModel: text('selected_model'),
    estimatedCostCents: integer('estimated_cost_cents'),
    actualCostCents: integer('actual_cost_cents'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('tasks_project_id_idx').on(t.projectId),
    index('tasks_team_id_idx').on(t.teamId),
    index('tasks_status_idx').on(t.status),
  ]
)

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  team: one(teams, { fields: [tasks.teamId], references: [teams.id] }),
  modelResults: many(modelResults),
  diffs: many(diffs),
}))

// ─── model_results ───────────────────────────────────────────────────
export const modelResults = pgTable('model_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  modelName: text('model_name').notNull(),
  provider: varchar('provider', { length: 20 }).notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  costCents: integer('cost_cents').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  content: text('content'),
  success: boolean('success').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const modelResultsRelations = relations(modelResults, ({ one }) => ({
  task: one(tasks, { fields: [modelResults.taskId], references: [tasks.id] }),
}))

// ─── diffs ───────────────────────────────────────────────────────────
export const diffs = pgTable(
  'diffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    modelResultId: uuid('model_result_id')
      .notNull()
      .references(() => modelResults.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    operation: varchar('operation', { length: 10 }).notNull(),
    beforeContent: text('before_content'),
    afterContent: text('after_content'),
    hunks: jsonb('hunks').$type<Array<{
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
      lines: string[]
    }>>(),
    linesAdded: integer('lines_added').notNull().default(0),
    linesRemoved: integer('lines_removed').notNull().default(0),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    flagged: boolean('flagged').notNull().default(false),
    blocked: boolean('blocked').notNull().default(false),
    safetyViolations: jsonb('safety_violations').$type<Array<{
      rule: string
      severity: 'warn' | 'block'
      message: string
    }>>().notNull().default([]),
    applied: boolean('applied').notNull().default(false),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('diffs_task_id_idx').on(t.taskId),
    index('diffs_status_idx').on(t.status),
  ]
)

export const diffsRelations = relations(diffs, ({ one }) => ({
  task: one(tasks, { fields: [diffs.taskId], references: [tasks.id] }),
  modelResult: one(modelResults, { fields: [diffs.modelResultId], references: [modelResults.id] }),
}))

// ─── cost_logs ───────────────────────────────────────────────────────
export const costLogs = pgTable(
  'cost_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' }),
    modelName: text('model_name').notNull(),
    provider: varchar('provider', { length: 20 }).notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    costCents: integer('cost_cents').notNull(),
    billingPeriod: varchar('billing_period', { length: 7 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cost_logs_team_id_idx').on(t.teamId),
    index('cost_logs_billing_period_idx').on(t.billingPeriod),
    index('cost_logs_model_name_idx').on(t.modelName),
  ]
)

export const costLogsRelations = relations(costLogs, ({ one }) => ({
  team: one(teams, { fields: [costLogs.teamId], references: [teams.id] }),
  task: one(tasks, { fields: [costLogs.taskId], references: [tasks.id] }),
}))

// ─── team_billing_history ────────────────────────────────────────────
export const teamBillingHistory = pgTable(
  'team_billing_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    billingPeriod: varchar('billing_period', { length: 7 }).notNull(),
    totalCostCents: integer('total_cost_cents').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    taskCount: integer('task_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('team_billing_history_team_period_idx').on(t.teamId, t.billingPeriod),
  ]
)

export const teamBillingHistoryRelations = relations(teamBillingHistory, ({ one }) => ({
  team: one(teams, { fields: [teamBillingHistory.teamId], references: [teams.id] }),
}))

// ─── integrations ────────────────────────────────────────────────────
export const integrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 30 }).notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const integrationsRelations = relations(integrations, ({ one }) => ({
  project: one(projects, { fields: [integrations.projectId], references: [projects.id] }),
}))

// ─── webhooks ────────────────────────────────────────────────────────
export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  events: jsonb('events').$type<string[]>().notNull().default([]),
  secret: text('secret'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const webhooksRelations = relations(webhooks, ({ one }) => ({
  project: one(projects, { fields: [webhooks.projectId], references: [projects.id] }),
}))

// ─── feature_flags ───────────────────────────────────────────────────
export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  enabled: boolean('enabled').notNull().default(false),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── audit_logs ──────────────────────────────────────────────────────
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resource: text('resource').notNull(),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_team_id_idx').on(t.teamId),
    index('audit_logs_action_idx').on(t.action),
  ]
)
