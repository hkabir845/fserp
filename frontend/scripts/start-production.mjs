import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nextCli = require.resolve('next/dist/bin/next')
const rawPort = process.env.PORT || '3000'
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
  console.error(`Invalid PORT: ${rawPort}`)
  process.exit(2)
}

const child = spawn(process.execPath, [nextCli, 'start', '-H', '127.0.0.1', '-p', rawPort], {
  stdio: 'inherit',
  env: process.env,
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
