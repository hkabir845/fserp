# Filling Station ERP - Frontend

Next.js **16** frontend for Filling Station ERP (see `package.json` / `npm ls next`).

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Configure environment in [`.env`](.env) (defaults target `https://api.mahasoftcorporation.com` for the Django API and Next on port 3000). For production, set `NEXT_PUBLIC_*` to your API/UI hosts (see commented block in `.env`). Note: `.env.local` overrides `.env` if present.

3. Run development server:
```bash
npm run dev
```

Open `http://localhost:3000`

## Project Structure

```
frontend/
├── .env                 # Env vars (dev + production; see comments inside)
├── src/
│   ├── app/             # Next.js App Router pages
│   ├── components/      # React components
│   ├── lib/             # Utilities (API, WebSocket)
│   └── types/           # TypeScript types
├── public/              # Static files
├── package.json
├── tsconfig.json
└── tailwind.config.ts
```

## Build for Production

Set `NEXT_PUBLIC_*` in [`.env`](.env) to your production API/UI hosts (see commented block in that file), then:

```bash
npm run build
npm start
```

If you previously used `.env.local` or `.env.production`, remove them and rely on `.env` only. Close any editor holding old `frontend/.env.example` / `env.local.example` files so they can be deleted from disk if they still appear.

## Key Features

- **Real-time Updates:** WebSocket integration
- **Live Invoice Preview:** Instant calculations
- **Responsive Design:** Works on all devices
- **TypeScript:** Full type safety
- **Tailwind CSS:** Modern styling











