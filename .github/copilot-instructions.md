# OrchestraLay Workspace Instructions

Use these instructions for all work in this repository.

## Product boundary

- OrchestraLay is a Node 20 orchestration layer between frontier AI models and developers.
- The backend must stay on Express, tRPC, Drizzle ORM, Supabase PostgreSQL, and pg-boss.
- The frontend must stay on Vite, React 19, Wouter, and TailwindCSS.
- Deployment targets a single Railway service that runs the API and worker in one process.

## Architectural rules

- Follow the build order and known bugs documented in the root CLAUDE.md file.
- Treat the root AGENTS.md file as the authoritative architecture reference.
- Never bypass the documented safety boundary: server code computes and stores diffs, but only the CLI writes approved changes to disk.
- Keep costs as integer cents and use server-generated timestamps only.
- Resolve model selection through the documented 6-gate routing flow and call estimateTokens before resolveModel.
- Keep n8n outside the request-response critical path.

## Auth and authorization

- Support exactly two auth surfaces: Supabase JWT dashboard users and SHA-256 API key callers.
- Keep auth logic inside the shared tRPC context and guard middleware, not inside individual procedures.
- When a caller does not own a resource, return NOT_FOUND instead of leaking existence through FORBIDDEN unless the contract explicitly requires FORBIDDEN.

## Safety and diff handling

- Implement every safety rule from AGENTS.md and CLAUDE.md before treating diff approval as complete.
- Blocked diffs must remain unapprovable through the API.
- Never auto-apply diffs unless project settings explicitly allow it.

## Delivery expectations

- Prefer small, coherent increments that leave the repo runnable.
- Update README.md and env templates when runtime behavior changes.
- Keep Docker and Railway assets aligned with the actual local startup sequence.