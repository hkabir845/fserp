# Filling Station ERP - Frontend

Next.js 14 frontend for Filling Station ERP system.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local` file:
```env
API_URL=https://fsapi.sascorporationbd.com
WS_URL=ws://localhost:8000
```

3. Run development server:
```bash
npm run dev
```

Open `http://localhost:3000`

## Project Structure

```
frontend/
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

```bash
npm run build
npm start
```

## Key Features

- **Real-time Updates:** WebSocket integration
- **Live Invoice Preview:** Instant calculations
- **Responsive Design:** Works on all devices
- **TypeScript:** Full type safety
- **Tailwind CSS:** Modern styling

















