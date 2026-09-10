# AGENTS.md

Conventions for anyone, human or AI, changing this repo.

## Commands

- `npm install`
- `SUPERVISOR_PASSWORD=dev npm run dev`: server on :3001 and UI on :5173.
- `npm test`: server tests (`node:test`).
- `npm run typecheck`: server and UI.
- `npm run build`: builds the UI into `web/dist`. The server has no build step.

## Where things go

- `shared/types.ts`: the JSON shapes on the wire. The server and the UI
  both import from here; don't redefine them.
- `server/tasks.ts`: every task state change. Each change runs in one
  transaction and logs its event in that transaction.
- `server/agents.ts`: agents and keys. `server/auth.ts`: hashing, sessions,
  and `accessControl`, the one gate every request passes: `/api/*` needs an
  agent key, `/admin/*` a session, and any other route is refused unless
  it's in `PUBLIC_ROUTES`. Don't add auth checks to route files; a test
  checks every registered route automatically.
- `server/agent-api.ts` and `server/admin-api.ts`: HTTP routes only. Logic
  belongs in the modules above.
- `web/src/api.ts`: every call the UI makes. Components never call `fetch`.

## Code style

- Node runs the server's TypeScript directly (type stripping). So: import
  with the real extension (`./db.ts`), use `import type` for types, and
  avoid syntax that needs compiling (enums, namespaces, constructor
  parameter properties). `npm run typecheck` enforces this.
- Strict TypeScript. No `any` without a comment saying why.
- Keep it small. Before adding a new status, table, or background job,
  check whether an existing one already covers it.
- Never return an agent's full API key except in the response that issues it.

## Tests

- New or changed endpoints get a test in `server/app.test.ts`: who may call
  it, what it rejects, and what it changes.

## Git

- Short imperative commit subjects. Every line at most 72 characters.
- When an AI wrote the change, end the commit with a `Co-Authored-By:`
  trailer naming the model.
- Never commit `node_modules/`, `web/dist/`, `data/`, or `.env` files.
