# CLI Guide

> **Status:** Implementation in progress on branch `claude/add-claude-md-file-VA6l8` (`cli/index.ts`). This documentation tracks the CLI as it is built by a parallel agent.

---

## Installation

The CLI is part of the main OrchestraLay repository (in `cli/index.ts`). Once the implementation branch lands, run it from the project root:

```bash
# From the project directory
npx tsx cli/index.ts submit --prompt "..." --type code_generation
```

Or alias it for convenience:
```bash
alias orchestralay="npx tsx cli/index.ts"
```

---

## Configuration

Set your API key as an environment variable:

```bash
export ORCHESTRALAY_API_KEY=olay_your_key_here
```

Get your API key from the dashboard: sign in → Auth → Create API Key → copy the key (shown once).

By default the CLI connects to `http://localhost:3001`. Set `ORCHESTRALAY_API_URL` to point at a different server.

---

## Commands

### `submit` — Submit a Task

```bash
orchestralay submit \
  --prompt "Add error handling to the fetchUser function" \
  --type refactoring
```

**Flags:**

| Flag | Required | Description |
|---|---|---|
| `--prompt` | Yes | The task prompt |
| `--type` | Yes | One of: `code_generation`, `debugging`, `refactoring`, `analysis`, `review` |
| `--model` | No | Preferred model (e.g., `claude-3-5-sonnet`, `gpt-4o`) |
| `--budget` | No | Max cost in cents |
| `--timeout` | No | Model call timeout in seconds |

**Behavior:**
1. Submits the task via `tasks.submit`
2. Polls `tasks.getStatus` every 2 seconds
3. Prints the final result: model used, cost, and diff count

**Output behavior:**
- **stderr:** Human-readable status updates (submitting, polling with `\r` overwrite, completion summary)
- **stdout:** JSON object `{ taskId, status }` for scripting/piping

The CLI updates the status line in-place during polling (showing current status + model when available). On completion, it prints a summary to stderr with model, cost (formatted as `$X.XXXX`), and diff count. Exit code 1 on failure, 0 on success.

---

### `status` — Check Task Status

```bash
orchestralay status --task-id task_a3f9xx
```

**Output:**
- **stderr:** Formatted status details (Task ID, Status, Type, Model, Cost, Diffs pending). If `metadata.reasoning` exists, prints routing decisions.
- **stdout:** Full status object as JSON (for scripting)

---

### `apply` — Apply or Revert Diffs

```bash
# Apply approved diffs to disk
orchestralay apply --task-id task_a3f9xx

# Preview changes without writing
orchestralay apply --task-id task_a3f9xx --dry-run

# Revert previously applied changes
orchestralay apply --task-id task_a3f9xx --revert
```

**Flags:**

| Flag | Description |
|---|---|
| `--task-id` | The task to apply diffs from |
| `--dry-run` | Print what would change without writing files |
| `--revert` | Restore original file contents and mark diffs as reverted |

**Apply behavior:**
1. Fetches all diffs for the task via `diffs.getForTask`
2. Filters for `status=approved` AND `applied=false`
3. For each diff, fetches full content via `diffs.getContent` (returns `{ operation, filePath, afterContent, linesAdded, linesRemoved }`)
4. **delete:** Removes file via `fs.unlink()`
5. **create/modify:** Creates parent directories via `fs.mkdir(dir, { recursive: true })`, writes file via `fs.writeFile(filePath, afterContent, 'utf-8')`
6. Marks all applied diffs via `diffs.markApplied({ diffIds })`

**Revert behavior:**
1. Fetches diffs, filters for `applied=true`
2. For each: calls `diffs.revert({ diffId })` which returns `{ beforeContent, filePath }`
3. If `beforeContent` exists: restores file to disk
4. If `beforeContent` is null (was a creation): deletes the file (silently ignores if already gone)

**Important:** Only approved diffs are applied. If a diff is still pending or blocked, it's skipped. Approve diffs first in the dashboard or via the API.

---

## Common Workflows

### Submit → Review → Apply

```bash
# 1. Submit a task
orchestralay submit --prompt "Refactor auth middleware to use async/await" --type refactoring

# 2. Review diffs in the dashboard at http://localhost:5173/diffs
#    Approve or reject each file change

# 3. Apply approved changes
orchestralay apply --task-id task_a3f9xx
```

### Budget-Constrained Task

```bash
# Limit cost to 10 cents — the router will prefer cheaper models
orchestralay submit \
  --prompt "Analyze this error log and suggest fixes" \
  --type debugging \
  --budget 10
```

### Specific Model

```bash
# Force claude-3-5-sonnet for code generation
orchestralay submit \
  --prompt "Add unit tests for the UserService class" \
  --type code_generation \
  --model claude-3-5-sonnet
```

### Dry Run Before Applying

```bash
# See what files would change
orchestralay apply --task-id task_a3f9xx --dry-run

# If it looks good, apply for real
orchestralay apply --task-id task_a3f9xx
```

### Undo Applied Changes

```bash
# Revert all applied diffs back to their original content
orchestralay apply --task-id task_a3f9xx --revert
```

---

## Error Messages

| Error | Cause | Fix |
|---|---|---|
| `UNAUTHORIZED` | Missing or invalid API key | Check `ORCHESTRALAY_API_KEY` is set and valid |
| `TOO_MANY_REQUESTS` | Rate limit exceeded | Wait for `retryAfter` seconds |
| `FORBIDDEN: Budget exceeded` | Team or project budget cap hit | Increase budget in dashboard settings |
| `No approved diffs to apply` | No diffs are approved for this task | Review and approve diffs in the dashboard first |
