// usage: node with-load.mjs <workers> <script.mjs> [args...]
// Runs the script while <workers> busy-loop processes compete for the CPUs, then stops exactly those workers.
import { spawn, spawnSync } from 'node:child_process'

const [n, script, ...args] = process.argv.slice(2)
const workers = []
for (let i = 0; i < Number(n); i++) workers.push(spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore', windowsHide: true }))
console.log(`load: ${workers.length} busy workers started`)
const r = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env: process.env })
for (const w of workers) spawnSync('taskkill', ['/PID', String(w.pid), '/T', '/F'], { stdio: 'ignore' })
console.log('load: workers stopped')
process.exit(r.status ?? 1)
