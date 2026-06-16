/**
 * PM2 process definitions for FSERP on a Linux VPS.
 *
 * Start from repo root:
 *   pm2 start ecosystem.config.js
 *   pm2 startOrReload ecosystem.config.js --update-env
 *
 * Django loads backend/.env automatically (python-dotenv in fsms/settings.py).
 * Ensure backend/.env exists with DJANGO_SECRET_KEY and DATABASE_URL before first start.
 *
 * Ports (shared VPS with VIPTAP on 8000/3000): FSERP backend 8001, frontend 3001.
 */
const path = require('path')

const repoRoot = __dirname

module.exports = {
  apps: [
    {
      name: 'fserp_backend',
      cwd: repoRoot,
      script: path.join(repoRoot, 'scripts/run-gunicorn.sh'),
      interpreter: 'bash',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'fserp_frontend',
      cwd: path.join(repoRoot, 'frontend'),
      script: 'npm',
      args: 'run start',
      interpreter: 'none',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
    },
  ],
}
