/**
 * PM2 process definitions for FSERP on a Linux VPS (live production).
 *
 * Start from repo root:
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup   # once, as root — survives reboot
 *
 * Keep alive helper (cron every minute):
 *   bash scripts/ensure-fserp-up.sh
 *
 * Django loads backend/.env automatically (python-dotenv in fsms/settings.py).
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
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      // Live site: keep restarting; backoff avoids crash loops hammering the host.
      max_restarts: 80,
      min_uptime: '5s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 15000,
      listen_timeout: 20000,
      max_memory_restart: '900M',
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
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 80,
      min_uptime: '5s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 10000,
      listen_timeout: 20000,
      max_memory_restart: '700M',
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
    },
  ],
}
