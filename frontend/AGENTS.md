<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# FSERP frontend — agent notes

## Session / auth

- Prefer `requireSession()` from `@/lib/authSession` (or `ensureAccessTokenFresh()` from `@/lib/api`) for page gates. Do **not** gate on bare `readStoredAccessToken()` — cookie-backed silent refresh means a missing access JWT is often still a valid session.
- `isApiSessionError` is **401 only**. Treat **403** as permission denied (toast), not logout.

## Aquaculture UI

- Multi-line fish sales must create sequentially with compensating deletes on failure — never `Promise.allSettled` partial commits.
- Biological sales require `production_cycle_id` (backend enforces).
- Company aquaculture P&amp;L eliminates inter-pond IPT revenue/cost; pond rows still show pond-level figures.

## Data fetching

- Prefer React Query for list/detail loaders when touching a screen; many pages still use ad-hoc `useEffect` (add AbortController / generation guards if keeping manual fetch).
- Mobile Capacitor app lives at repo-root `mobile/`, not under `frontend/`.
