/**
 * Port 3000 is reserved for filling-station-erp-frontend (`next dev` / `next start`).
 * Stops any other process listening on 3000 (fixes Windows EADDRINUSE from stale node).
 */
import { execSync } from 'node:child_process'

const PORT = '3000'

if (process.platform !== 'win32') {
  process.exit(0)
}

let out = ''
try {
  out = execSync(`netstat -ano | findstr ":${PORT}" | findstr "LISTENING"`, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  })
} catch {
  process.exit(0)
}

const pids = new Set()
for (const line of out.split(/\r?\n/)) {
  const parts = line.trim().split(/\s+/)
  const pid = parts[parts.length - 1]
  if (/^\d+$/.test(pid)) pids.add(pid)
}

for (const pid of pids) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' })
    console.log(`[dev] Freed port ${PORT} (stopped PID ${pid})`)
  } catch {
    /* already gone */
  }
}

if (pids.size > 0 && process.platform === 'win32') {
  try {
    execSync('ping 127.0.0.1 -n 3 >nul', { stdio: 'ignore', shell: true })
  } catch {
    /* ignore */
  }
}
