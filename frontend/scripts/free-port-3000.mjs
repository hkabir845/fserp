/**
 * Port 3000 is reserved for filling-station-erp-frontend (`next dev` / `next start`).
 * Stops any other process listening on 3000 (fixes Windows EADDRINUSE from stale node).
 *
 * netstat can hang on some Windows setups; all subprocess calls use a short timeout so
 * `npm run dev` never blocks indefinitely in predev.
 */
import { execSync } from 'node:child_process'

const PORT = '3000'
const EXEC_TIMEOUT_MS = 5000
const MAX_ATTEMPTS = 5

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
      ...opts,
    })
  } catch (err) {
    if (err.killed || err.code === 'ETIMEDOUT') {
      console.warn(
        `[dev] Port ${PORT} check timed out after ${EXEC_TIMEOUT_MS}ms; continuing. ` +
          'If you see EADDRINUSE, stop the other process on port 3000 manually.',
      )
    }
    return null
  }
}

function findListeningPids() {
  const out =
    run(`netstat -ano -p tcp | findstr "LISTENING" | findstr ":${PORT} "`) ?? ''

  const pids = new Set()
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    const pid = parts[parts.length - 1]
    if (/^\d+$/.test(pid)) pids.add(pid)
  }
  return pids
}

function killPid(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, {
      stdio: 'ignore',
      timeout: EXEC_TIMEOUT_MS,
      windowsHide: true,
    })
    console.log(`[dev] Freed port ${PORT} (stopped PID ${pid})`)
    return true
  } catch {
    return false
  }
}

function waitForPortRelease() {
  run('ping 127.0.0.1 -n 3 >nul', { shell: true, stdio: 'ignore' })
}

if (process.platform !== 'win32') {
  process.exit(0)
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const pids = findListeningPids()
  if (pids.size === 0) {
    break
  }

  for (const pid of pids) {
    killPid(pid)
  }

  waitForPortRelease()

  const remaining = findListeningPids()
  if (remaining.size === 0) {
    break
  }

  if (attempt === MAX_ATTEMPTS) {
    console.warn(
      `[dev] Port ${PORT} still in use after ${MAX_ATTEMPTS} attempts ` +
        `(PIDs: ${[...remaining].join(', ')}). Stop them manually or run: npm run kill:3000`,
    )
  }
}

process.exit(0)
