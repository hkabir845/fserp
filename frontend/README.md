# FSERP frontend

## Local development

1. **Backend (one instance)** — from repo root:
   ```bat
   backend\run-dev.bat
   ```
   Stops any process already on port 8000, then starts Django at `http://127.0.0.1:8000`.

2. **Frontend** — from this folder:
   ```bat
   npm run dev
   ```
   Uses **Webpack** (stable on Windows with large pages). First visit to each route still compiles on demand (often 10–60s). For faster reloads when file locks are not an issue, try `npm run dev:turbo`.

3. **Clean restart** (if `.next` is corrupted on Windows):
   ```bat
   npm run clean:next
   npm run dev
   ```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Webpack dev server on port 3000 (default) |
| `npm run dev:turbo` | Turbopack dev (faster; can hit file-lock errors on Windows) |
| `npm run dev:webpack` | Same as `npm run dev` |
| `npm run restart-dev.bat` | Kill :3000, delete `.next`, start dev |
| `backend\run-dev.bat` | Kill :8000 duplicates, start Django |

## Environment

- `frontend/.env.development` — local API (`http://localhost:8000`), 15s API timeout
- Do not put loopback URLs in `.env.local` for production builds (see `next.config.mjs`)
