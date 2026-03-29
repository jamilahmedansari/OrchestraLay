# Diff Engine & Safety Rules

> **Status:** Implementation in progress on branch `claude/add-claude-md-file-VA6l8` (diff engine pipeline). This documentation tracks the safety system as it is built by a parallel agent.

---

## How the Diff Engine Works

When a model completes a task, its output is processed through a 4-stage pipeline before any human sees it. The diff engine **never writes files to disk** — it produces data for review.

```
Model Output
    │
    ▼
┌──────────────────┐
│  1. Parse         │  Extract <file_changes> XML → file operations
│  (outputParser)   │  Sanitize paths: strip ../, leading /, backslashes
└────────┬─────────┘
         │
    ▼
┌──────────────────┐
│  2. Diff          │  Compute unified diff for each file operation
│  (diffComputer)   │  Line counts, hunk generation, binary detection
└────────┬─────────┘
         │
    ▼
┌──────────────────┐
│  3. Safety Check  │  Run 8 safety rules against each operation
│  (safetyRules)    │  Flag warnings, block dangerous changes
└────────┬─────────┘
         │
    ▼
┌──────────────────┐
│  4. Persist       │  Store diffs in database with safety metadata
│  (diffEngine)     │  Broadcast preview to dashboard via Realtime
└──────────────────┘
```

Each file operation becomes one row in the `diffs` table, containing: the unified diff hunks, before/after content, safety violations, and blocked/flagged status.

The model output is expected in XML format:
```xml
<file_changes>
  <file>
    <path>src/app.ts</path>
    <operation>modify</operation>
    <before_content>...</before_content>
    <after_content>...</after_content>
  </file>
</file_changes>
```

Path sanitization rejects `../`, leading `/`, null bytes, and normalizes backslashes. Invalid paths are silently skipped. Binary files are detected by checking for null bytes in the first 8000 characters — no hunks are generated for binary files.

---

## File Operations

The model can propose three types of file operations:

| Operation | Description |
|---|---|
| `create` | New file with content |
| `modify` | Change existing file (before + after content) |
| `delete` | Remove a file |

---

## The 8 Safety Rules

Every file operation is checked against these rules. **Block** means the diff cannot be approved via API. **Warn** means it's flagged but can still be approved.

| # | Rule | Triggers On | Severity |
|---|---|---|---|
| 1 | `protected_file` | `.env*`, `*.lock`, `*.lockb`, `package-lock.json` | **block** |
| 2 | `file_deletion` | Any delete operation (when `allowFileDeletion = false`) | **block** |
| 3 | `framework_change` | `package.json`, `tsconfig.json`, `vite.config.*`, `next.config.*`, `tailwind.config.*` | **block** |
| 4 | `config_file_change` | `*.config.*`, `.eslintrc`, `.prettierrc`, `Dockerfile`, `docker-compose.*` | warn |
| 5 | `test_deletion` | Delete + test file pattern (`*.test.*`, `*.spec.*`, `__tests__/`) | **block** |
| 6 | `custom_blocked_path` | Paths matching `project.safetyRules.customBlockedPaths[]` | **block** |
| 7 | `large_change` | before > 50 lines AND change ratio > 80% | warn |
| 8 | `potential_secret` | Regex matches: `api_key=`, `sk-` patterns, JWT, `PRIVATE KEY` in new content | **block** |

---

## Blocked vs Flagged

- **Flagged (warn):** The diff appears with a warning badge. You can still approve it.
- **Blocked:** The approve endpoint returns FORBIDDEN. You **must** change the project's safety settings to unblock it — there is no override button.

This is intentional. Blocked diffs represent genuinely dangerous operations (secrets in code, env file changes, lockfile modifications). A human must consciously change the project configuration, not just click "approve anyway."

---

## Approval Flow

```
Diff created (pending)
    │
    ├── approve  ──► approved (ready for apply)
    │                    │
    │                    └── apply ──► applied (written to disk)
    │
    ├── reject   ──► rejected
    │
    └── blocked  ──► cannot approve (change project settings first)
```

### Approving diffs

- **Single diff:** `diffs.approve(diffId)` — approves one diff
- **Batch approve:** `diffs.approveAll({ taskId, skipFlagged })` — approves all non-blocked diffs for a task
- **Dashboard:** "Approve all safe" button in the Diff Review page

### Applying diffs

Approval does not write files. To apply changes to disk:

```bash
orchestralay apply --task-id <id>
```

This fetches all approved, non-applied diffs, writes files to the developer's filesystem, and marks them as applied in the database.

---

## Customizing Safety Per Project

Each project has configurable safety settings:

| Setting | Default | Effect |
|---|---|---|
| `allowFileDeletion` | `false` | When true, file delete operations are not blocked |
| `allowFrameworkChanges` | `false` | When true, package.json/tsconfig changes are not blocked |
| `allowTestFileDeletion` | `false` | When true, test file deletions are not blocked |
| `customBlockedPaths` | `[]` | Array of glob patterns that are always blocked |

These are set per project through the dashboard. Changing a setting unblocks previously blocked diffs that were only blocked by that rule.

---

## Reverting Applied Changes

If you applied diffs and need to undo:

```bash
orchestralay apply --task-id <id> --revert
```

This calls `diffs.revert` per diff, which resets `applied=false`, `appliedAt=null`, and `status='pending'` in the database. The CLI then restores `beforeContent` to disk (or deletes the file if it was a `create` operation with no prior content).

---

## Dry Run

Preview what would be written without actually changing files:

```bash
orchestralay apply --task-id <id> --dry-run
```

Prints the file paths and operations that would be performed.
