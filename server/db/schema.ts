import { InferInsertModel, InferSelectModel, relations, sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export type JsonObject = Record<string, unknown>

export type ProjectSafetyRules = {
  allowFileDeletion?: boolean
  allowFrameworkChanges?: boolean
  allowTestFileDeletion?: boolean
  customBlockedPaths?: string[]
}

export type TaskMetadata = JsonObject & {
  routingReasoning?: string[]
}

export const teamRoleEnum = pgEnum('team_role', ['owner', 'admin', 'member'])
export const taskTypeEnum = pgEnum('task_type', [
  'code_generation',
  'debugging',
  'refactoring',
  'analysis',
  'review',
])
export const taskStatusEnum = pgEnum('task_status', [
  'submitted',
  'routing',
  'executing',
  'completed',
  'failed',
  'cancelled',
])
export const diffOperationEnum = pgEnum('diff_operation', ['create', 'modify', 'delete'])
export const modelResultStatusEnum = pgEnum('model_result_status', ['success', 'failed'])

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  displayName: varchar('display_name', { length: 120 }),
  ...timestamps,
})

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 120 }).notNull().unique(),
  plan: varchar('plan', { length: 32 }).notNull().default('starter'),
  monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(0),
  currentMonthSpendCents: integer('current_month_spend_cents').notNull().default(0),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  ...timestamps,
})

export const teamMembers = pgTable(
  'team_members',
  {
    teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: teamRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.teamId, table.userId] }),
    userIdx: index('team_members_user_idx').on(table.userId),
  }),
)

export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 120 }).notNull(),
  description: text('description'),
  autoApplyChanges: boolean('auto_apply_changes').notNull().default(false),
  monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(0),
  safetyRules: jsonb('safety_rules').$type<ProjectSafetyRules>().notNull().default({}),
  ...timestamps,
})

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    name: varchar('name', { length: 120 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    revoked: boolean('revoked').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    keyHashIdx: uniqueIndex('api_keys_key_hash_idx').on(table.keyHash),
    projectIdx: index('api_keys_project_idx').on(table.projectId),
  }),
)

export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    keyId: uuid('key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
    bucketType: varchar('bucket_type', { length: 32 }).notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    keyWindowIdx: uniqueIndex('rate_limit_buckets_key_window_idx').on(
      table.keyId,
      table.bucketType,
      table.windowStart,
    ),
  }),
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    submittedByKeyId: uuid('submitted_by_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    prompt: text('prompt').notNull(),
    taskType: taskTypeEnum('task_type').notNull(),
    preferredModels: jsonb('preferred_models').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    budgetCents: integer('budget_cents').notNull().default(0),
    timeoutSeconds: integer('timeout_seconds').notNull().default(60),
    status: taskStatusEnum('status').notNull().default('submitted'),
    selectedModel: varchar('selected_model', { length: 64 }),
    routingReasoning: jsonb('routing_reasoning').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata').$type<TaskMetadata>().notNull().default({}),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    teamStatusIdx: index('tasks_team_status_idx').on(table.teamId, table.status),
    projectCreatedIdx: index('tasks_project_created_idx').on(table.projectId, table.createdAt),
  }),
)

export const modelResults = pgTable(
  'model_results',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    modelName: varchar('model_name', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    status: modelResultStatusEnum('status').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    latencyMs: integer('latency_ms').notNull().default(0),
    content: text('content'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('model_results_task_idx').on(table.taskId),
  }),
)

export const diffs = pgTable(
  'diffs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    modelResultId: uuid('model_result_id').notNull().references(() => modelResults.id, { onDelete: 'cascade' }),
    operation: diffOperationEnum('operation').notNull(),
    filePath: text('file_path').notNull(),
    beforeContent: text('before_content'),
    afterContent: text('after_content'),
    hunks: jsonb('hunks').$type<JsonObject[]>().notNull().default(sql`'[]'::jsonb`),
    linesAdded: integer('lines_added').notNull().default(0),
    linesRemoved: integer('lines_removed').notNull().default(0),
    flagged: boolean('flagged').notNull().default(false),
    blocked: boolean('blocked').notNull().default(false),
    safetyViolations: jsonb('safety_violations').$type<JsonObject[]>().notNull().default(sql`'[]'::jsonb`),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    rejectedByUserId: uuid('rejected_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskIdx: index('diffs_task_idx').on(table.taskId),
    blockedIdx: index('diffs_blocked_idx').on(table.blocked, table.flagged),
  }),
)

export const integrations = pgTable('integrations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 48 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  config: jsonb('config').$type<JsonObject>().notNull().default({}),
  ...timestamps,
})

export const webhooks = pgTable('webhooks', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret'),
  enabled: boolean('enabled').notNull().default(true),
  events: jsonb('events').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  ...timestamps,
})

export const costLogs = pgTable(
  'cost_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    modelResultId: uuid('model_result_id').references(() => modelResults.id, { onDelete: 'set null' }),
    modelName: varchar('model_name', { length: 64 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    costCents: integer('cost_cents').notNull().default(0),
    billingPeriod: varchar('billing_period', { length: 7 }).notNull(),
    requestStartedAt: timestamp('request_started_at', { withTimezone: true }).notNull().defaultNow(),
    requestCompletedAt: timestamp('request_completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    teamBillingIdx: index('cost_logs_team_billing_idx').on(table.teamId, table.billingPeriod),
    modelStartedIdx: index('cost_logs_model_started_idx').on(table.modelName, table.requestStartedAt),
  }),
)

export const teamBillingHistory = pgTable(
  'team_billing_history',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
    billingPeriod: varchar('billing_period', { length: 7 }).notNull(),
    costCents: integer('cost_cents').notNull().default(0),
    tokensUsed: integer('tokens_used').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    teamBillingUnique: uniqueIndex('team_billing_history_team_period_idx').on(
      table.teamId,
      table.billingPeriod,
    ),
  }),
)

export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').defaultRandom().primaryKey(),
  flagKey: varchar('flag_key', { length: 120 }).notNull().unique(),
  description: text('description'),
  enabled: boolean('enabled').notNull().default(false),
  config: jsonb('config').$type<JsonObject>().notNull().default({}),
  ...timestamps,
})

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 120 }).notNull(),
  entityType: varchar('entity_type', { length: 120 }).notNull(),
  entityId: text('entity_id'),
  payload: jsonb('payload').$type<JsonObject>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  teamMemberships: many(teamMembers),
  projectsCreatedKeys: many(apiKeys),
}))

export const teamsRelations = relations(teams, ({ many }) => ({
  members: many(teamMembers),
  projects: many(projects),
  costLogs: many(costLogs),
}))

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  team: one(teams, {
    fields: [projects.teamId],
    references: [teams.id],
  }),
  apiKeys: many(apiKeys),
  tasks: many(tasks),
}))

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  project: one(projects, {
    fields: [apiKeys.projectId],
    references: [projects.id],
  }),
  createdByUser: one(users, {
    fields: [apiKeys.createdByUserId],
    references: [users.id],
  }),
  rateLimitBuckets: many(rateLimitBuckets),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  team: one(teams, {
    fields: [tasks.teamId],
    references: [teams.id],
  }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  modelResults: many(modelResults),
  diffs: many(diffs),
}))

export type User = InferSelectModel<typeof users>
export type Team = InferSelectModel<typeof teams>
export type TeamMember = InferSelectModel<typeof teamMembers>
export type Project = InferSelectModel<typeof projects>
export type ApiKey = InferSelectModel<typeof apiKeys>
export type Task = InferSelectModel<typeof tasks>
export type ModelResult = InferSelectModel<typeof modelResults>
export type Diff = InferSelectModel<typeof diffs>

export type NewUser = InferInsertModel<typeof users>
export type NewTeam = InferInsertModel<typeof teams>
export type NewProject = InferInsertModel<typeof projects>
export type NewApiKey = InferInsertModel<typeof apiKeys>
export type NewTask = InferInsertModel<typeof tasks>