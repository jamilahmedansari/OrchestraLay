import {
  pgTable,
  uuid,
  text,
  varchar,
  boolean,
  integer,
  timestamp,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── Enums ───────────────────────────────────────────────────────────

export const taskStatusEnum = pgEnum('task_status', [
  'submitted',
  'routing',
  'executing',
  'completed',
  'failed',
  'cancelled',
])

export const taskTypeEnum = pgEnum('task_type', [
  'code_generation',
  'debugging',
  'refactoring',
  'analysis',
  'review',
])

export const diffOperationEnum = pgEnum('diff_operation', [
  'create',
  'modify',
  'delete',
])

export const diffStatusEnum = pgEnum('diff_status', [
  'pending',
  'approved',
  'rejected',
  'applied',
  'reverted',
])

export const teamRoleEnum = pgEnum('team_role', [
  'owner',
  'admin',
  'member',
])

// ─── Tables ──────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  fullName: varchar('full_name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  supabaseUserId: uuid('supabase_user_id').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  plan: varchar('plan', { length: 50 }).notNull().default('starter'),
  monthlyTokenLimit: integer('monthly_token_limit').notNull().default(500000),
  monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(2900),
  currentMonthSpendCents: integer('current_month_spend_cents').notNull().default(0),
  billingPeriod: varchar('billing_period', { length: 7 }).notNull(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('team_members_team_user_idx').on(table.teamId, table.userId),
  ]
)

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    autoApplyChanges: boolean('auto_apply_changes').notNull().default(false),
    allowFileDeletion: boolean('allow_file_deletion').notNull().default(false),
    allowFrameworkChanges: boolean('allow_framework_changes').notNull().default(false),
    allowTestFileDeletion: boolean('allow_test_file_deletion').notNull().default(false),
    safetyRules: jsonb('safety_rules').$type<{
      customBlockedPaths?: string[]
    }>().default({}),
    monthlyBudgetCents: integer('monthly_budget_cents'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('projects_team_id_idx').on(table.teamId),
  ]
)

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull().unique(),
    keyPrefix: varchar('key_prefix', { length: 12 }).notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default(['tasks:write', 'tasks:read']),
    revoked: boolean('revoked').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('api_keys_key_hash_idx').on(table.keyHash),
    index('api_keys_project_id_idx').on(table.projectId),
  ]
)

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
    taskType: taskTypeEnum('task_type').notNull(),
    status: taskStatusEnum('status').notNull().default('submitted'),
    preferredModels: jsonb('preferred_models').$type<string[]>(),
    budgetCents: integer('budget_cents'),
    timeoutSeconds: integer('timeout_seconds').default(120),
    selectedModel: varchar('selected_model', { length: 100 }),
    estimatedCostCents: integer('estimated_cost_cents'),
    actualCostCents: integer('actual_cost_cents'),
    metadata: jsonb('metadata').$type<{
      reasoning?: string[]
      fallbackChain?: string[]
      baselineModel?: string
      baselineCostCents?: number
      directSavingsCents?: number
      diffSummary?: {
        diffCount: number
        blockedCount: number
        flaggedCount: number
      }
      error?: string
    }>(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_team_id_idx').on(table.teamId),
    index('tasks_status_idx').on(table.status),
    index('tasks_created_at_idx').on(table.createdAt),
  ]
)

export const modelResults = pgTable(
  'model_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    modelName: varchar('model_name', { length: 100 }).notNull(),
    provider: varchar('provider', { length: 50 }).notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    costCents: integer('cost_cents').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    content: text('content'),
    success: boolean('success').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('model_results_task_id_idx').on(table.taskId),
  ]
)

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
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    operation: diffOperationEnum('operation').notNull(),
    status: diffStatusEnum('status').notNull().default('pending'),
    beforeContent: text('before_content'),
    afterContent: text('after_content'),
    hunks: jsonb('hunks').$type<Array<{
      oldStart: number
      oldLines: number
      newStart: number
      newLines: number
      content: string
    }>>(),
    linesAdded: integer('lines_added').notNull().default(0),
    linesRemoved: integer('lines_removed').notNull().default(0),
    flagged: boolean('flagged').notNull().default(false),
    blocked: boolean('blocked').notNull().default(false),
    safetyViolations: jsonb('safety_violations').$type<Array<{
      rule: string
      severity: 'warn' | 'block'
      message: string
    }>>().default([]),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('diffs_task_id_idx').on(table.taskId),
    index('diffs_project_id_idx').on(table.projectId),
    index('diffs_team_id_idx').on(table.teamId),
    index('diffs_status_idx').on(table.status),
  ]
)

export const costLogs = pgTable(
  'cost_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    modelName: varchar('model_name', { length: 100 }).notNull(),
    provider: varchar('provider', { length: 50 }).notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    costCents: integer('cost_cents').notNull(),
    billingPeriod: varchar('billing_period', { length: 7 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cost_logs_team_id_idx').on(table.teamId),
    index('cost_logs_billing_period_idx').on(table.billingPeriod),
    index('cost_logs_created_at_idx').on(table.createdAt),
    index('cost_logs_model_name_idx').on(table.modelName),
  ]
)

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('rate_limit_buckets_key_type_idx').on(table.keyId, table.bucketType),
  ]
)

export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().default({}),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('integrations_project_id_idx').on(table.projectId),
  ]
)

export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    secret: varchar('secret', { length: 255 }),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('webhooks_project_id_idx').on(table.projectId),
  ]
)

export const teamBillingHistory = pgTable(
  'team_billing_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    billingPeriod: varchar('billing_period', { length: 7 }).notNull(),
    totalSpendCents: integer('total_spend_cents').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    taskCount: integer('task_count').notNull().default(0),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('team_billing_history_team_period_idx').on(table.teamId, table.billingPeriod),
  ]
)

export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  enabled: boolean('enabled').notNull().default(false),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 100 }).notNull(),
    resource: varchar('resource', { length: 100 }).notNull(),
    resourceId: uuid('resource_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_team_id_idx').on(table.teamId),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_created_at_idx').on(table.createdAt),
  ]
)

// ─── Relations ───────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
}))

export const teamsRelations = relations(teams, ({ many }) => ({
  teamMembers: many(teamMembers),
  projects: many(projects),
  costLogs: many(costLogs),
  billingHistory: many(teamBillingHistory),
}))

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  team: one(teams, { fields: [projects.teamId], references: [teams.id] }),
  apiKeys: many(apiKeys),
  tasks: many(tasks),
  integrations: many(integrations),
  webhooks: many(webhooks),
}))

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  project: one(projects, { fields: [apiKeys.projectId], references: [projects.id] }),
  team: one(teams, { fields: [apiKeys.teamId], references: [teams.id] }),
  rateLimitBuckets: many(rateLimitBuckets),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  team: one(teams, { fields: [tasks.teamId], references: [teams.id] }),
  modelResults: many(modelResults),
  diffs: many(diffs),
}))

export const modelResultsRelations = relations(modelResults, ({ one, many }) => ({
  task: one(tasks, { fields: [modelResults.taskId], references: [tasks.id] }),
  diffs: many(diffs),
}))

export const diffsRelations = relations(diffs, ({ one }) => ({
  task: one(tasks, { fields: [diffs.taskId], references: [tasks.id] }),
  modelResult: one(modelResults, { fields: [diffs.modelResultId], references: [modelResults.id] }),
  project: one(projects, { fields: [diffs.projectId], references: [projects.id] }),
  team: one(teams, { fields: [diffs.teamId], references: [teams.id] }),
}))

export const costLogsRelations = relations(costLogs, ({ one }) => ({
  team: one(teams, { fields: [costLogs.teamId], references: [teams.id] }),
  project: one(projects, { fields: [costLogs.projectId], references: [projects.id] }),
  task: one(tasks, { fields: [costLogs.taskId], references: [tasks.id] }),
}))

export const rateLimitBucketsRelations = relations(rateLimitBuckets, ({ one }) => ({
  apiKey: one(apiKeys, { fields: [rateLimitBuckets.keyId], references: [apiKeys.id] }),
}))

export const integrationsRelations = relations(integrations, ({ one }) => ({
  project: one(projects, { fields: [integrations.projectId], references: [projects.id] }),
}))

export const webhooksRelations = relations(webhooks, ({ one }) => ({
  project: one(projects, { fields: [webhooks.projectId], references: [projects.id] }),
}))

export const teamBillingHistoryRelations = relations(teamBillingHistory, ({ one }) => ({
  team: one(teams, { fields: [teamBillingHistory.teamId], references: [teams.id] }),
}))
