// Slice 18.1: the first real build, made executable (D-050). Run AFTER `npm run build:unpack` (or build:win); it reads dist/win-unpacked.
//   A. what is in the package: only out/, package.json and the production dependencies; none of src/, tools/, docs/, registry/, tests, .env, source maps,
//      the owner's files (PDFs, downloads, tsbuildinfo), no development package; the three entry files there; the packaged package.json is the repo's;
//   B. nothing of this PC in the bundles (the owner's user folder, his e-mail, the repo's path, the test folders);
//   C. the fuses: no running as Node, no NODE_OPTIONS, no --inspect, asar integrity on, the app only from app.asar;
//   D. the data-folder rule (dataFolderRule.ts) under plain Node: packaged -> %APPDATA%\frontier-app, a --user-data-dir wins, development untouched;
//      and the source keeps dataFolder.ts first in index.ts;
//   E. the packaged program itself, on a scratch profile: it starts and shows the app's page, the --user-data-dir is the one it uses (Chromium's
//      files appear there), no "Frontier App" folder appears in Roaming, and --inspect opens no debugger;
//   F. the exe is not Authenticode-signed (this stage ships unsigned, the Ed25519 check is for updates: 18.3) - reported, so a change is seen.
// Run: node tools/verify-18-1.mjs      (ONLY=A,C runs some parts; SKIP_LAUNCH=1 leaves out E)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const require = createRequire(join(REPO, 'package.json'))
const asar = require('@electron/asar')
const fuses = require('@electron/fuses')

const UNPACKED = process.env.UNPACKED_DIR ?? join(REPO, 'dist', 'win-unpacked')
const EXE = join(UNPACKED, 'frontier-app.exe')
const ASAR = join(UNPACKED, 'resources', 'app.asar')
const extract = (p) => asar.extractFile(ASAR, p.split('/').join(sep))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

check('the unpacked build is there (run npm run build:unpack first)', existsSync(EXE) && existsSync(ASAR), UNPACKED)
const entries = existsSync(ASAR) ? asar.listPackage(ASAR, { isPack: false }).map((p) => p.replaceAll('\\', '/').replace(/^\//, '')) : []
const files = entries.filter((p) => { try { return !asar.statFile(ASAR, p).files } catch { return true } })

await guard('A', async () => {
  check('A: the package lists files', files.length > 100, String(files.length))
  const outside = files.filter((p) => !(p.startsWith('out/') || p === 'package.json' || p.startsWith('node_modules/')))
  check('A: every file is under out/, node_modules/ or is package.json', outside.length === 0, show(outside))
  for (const top of ['src/', 'tools/', 'docs/', 'registry/', 'build/', 'resources/', 'dist/', '.claude/', '.git/'])
    check(`A: nothing from ${top}`, !entries.some((p) => p.startsWith(top)))
  const own = files.filter((p) => !p.startsWith('node_modules/'))
  const bad = own.filter((p) => /\.(map|ts|tsx|pdf|crdownload|tsbuildinfo|log)$/i.test(p) || /(^|\/)\.env/.test(p) || /(^|\/)(STEP-LOG|README|ROADMAP|DECISIONS)\.md$/i.test(p))
  check('A: no source map, TypeScript, PDF, download, tsbuildinfo, log, .env or notes among the app\'s own files', bad.length === 0, show(bad))
  check('A: no .env anywhere, not even in a dependency', !files.some((p) => /(^|\/)\.env(\.|$)/.test(p)), show(files.filter((p) => /\.env/.test(p))))
  for (const f of ['out/main/index.js', 'out/preload/index.js', 'out/preload/review.js', 'out/renderer/index.html'])
    check(`A: ${f} is in the package`, files.includes(f))
  const pkg = JSON.parse(extract('package.json').toString('utf8'))
  const repoPkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  check('A: the packaged package.json is the repo\'s (name, version, main)', pkg.name === 'frontier-app' && pkg.version === repoPkg.version && pkg.main === './out/main/index.js', show({ name: pkg.name, version: pkg.version, main: pkg.main }))
  // The production dependencies, by package-lock.json: every package in the package must be one that is not development-only.
  const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8'))
  const prod = new Set(Object.entries(lock.packages).filter(([k, v]) => k.startsWith('node_modules/') && !v.dev).map(([k]) => k))
  const devOnly = new Set(Object.entries(lock.packages).filter(([k, v]) => k.startsWith('node_modules/') && v.dev).map(([k]) => k))
  const packaged = new Set()
  for (const p of files.filter((f) => f.startsWith('node_modules/'))) {
    const parts = p.split('/')
    let i = 0; let key = ''
    while (i < parts.length - 1 && parts[i] === 'node_modules') {
      const name = parts[i + 1].startsWith('@') ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1]
      key = (key ? key + '/' : '') + 'node_modules/' + name
      i += name.includes('/') ? 3 : 2
    }
    packaged.add(key)
  }
  const notProd = [...packaged].filter((k) => !prod.has(k))
  check('A: every packaged dependency is a production one by package-lock.json', packaged.size > 0 && notProd.length === 0, show(notProd))
  const devIn = [...packaged].filter((k) => devOnly.has(k))
  check('A: no development-only package (electron, electron-builder, vite, react, typescript, eslint ...)', devIn.length === 0, show(devIn))
  for (const name of ['electron', 'electron-builder', 'vite', 'react', 'typescript', 'eslint', 'prettier'])
    check(`A: ${name} is not in the package`, !packaged.has(`node_modules/${name}`))
  for (const name of Object.keys(repoPkg.dependencies)) check(`A: the dependency ${name} is in the package`, packaged.has(`node_modules/${name}`))
  const res = readdirSync(join(UNPACKED, 'resources'))
  // build:win (the installer) adds electron-builder's elevate.exe, its helper for an install that needs admin; build:unpack does not
  check('A: resources/ holds app.asar and, after build:win, electron-builder\'s elevate.exe; nothing unpacked', res.includes('app.asar') && res.every((n) => n === 'app.asar' || n === 'elevate.exe'), show(res))
})

await guard('B', async () => {
  const own = files.filter((p) => p.startsWith('out/') && /\.(js|html|css)$/.test(p))
  const text = own.map((p) => extract(p).toString('utf8')).join('\n')
  check('B: the bundles were read', text.length > 1_000_000, String(text.length))
  for (const [name, re] of [['the owner\'s user folder', /91995/], ['the owner\'s e-mail', /bishalbgmp/i], ['the repo\'s path', /A:[\\/]+frontier-app/i], ['the test folders', /frontier-tmp|frontier-work/i], ['a source map link', /sourceMappingURL=(?!data:)/]])
    check(`B: no ${name} in the app's bundles`, !re.test(text), (text.match(re) ?? [''])[0])
})

await guard('C', async () => {
  const wire = await fuses.getCurrentFuseWire(EXE)
  const F = fuses.FuseV1Options
  const on = (o) => wire[o] === 49 // FuseState.ENABLE (the character '1'; the enum is not exported)
  check('C: the fuses can be read', wire && Object.keys(wire).length > 3, show(wire))
  check('C: RunAsNode is off', !on(F.RunAsNode))
  check('C: NODE_OPTIONS is off', !on(F.EnableNodeOptionsEnvironmentVariable))
  check('C: --inspect arguments are off', !on(F.EnableNodeCliInspectArguments))
  check('C: asar integrity is checked', on(F.EnableEmbeddedAsarIntegrityValidation))
  check('C: the app is loaded only from app.asar', on(F.OnlyLoadAppFromAsar))
})

await guard('D', async () => {
  const { pinnedDataFolder, DATA_FOLDER_NAME } = await import(`${REPO_URL}/src/main/dataFolderRule.ts`)
  const roaming = 'C:\\Users\\someone\\AppData\\Roaming'
  check('D: the name is frontier-app', DATA_FOLDER_NAME === 'frontier-app')
  check('D: packaged, no switch -> %APPDATA%\\frontier-app', pinnedDataFolder({ isPackaged: true, hasUserDataSwitch: false, appData: roaming }) === roaming + '\\frontier-app')
  check('D: packaged, with --user-data-dir -> left alone', pinnedDataFolder({ isPackaged: true, hasUserDataSwitch: true, appData: roaming }) === null)
  check('D: development -> left alone', pinnedDataFolder({ isPackaged: false, hasUserDataSwitch: false, appData: roaming }) === null)
  const index = readFileSync(join(REPO, 'src/main/index.ts'), 'utf8')
  const firstImport = index.split('\n').find((l) => /^import /.test(l))
  check('D: index.ts imports ./dataFolder before anything else', firstImport === "import './dataFolder'", firstImport)
  const df = readFileSync(join(REPO, 'src/main/dataFolder.ts'), 'utf8')
  check('D: dataFolder.ts sets userData from the rule, and imports nothing of the app', /app\.setPath\('userData', pinned\)/.test(df) && !/from '\.\/(?!dataFolderRule)/.test(df))
  const main = extract('out/main/index.js').toString('utf8')
  const pinAt = main.indexOf('"user-data-dir"') >= 0 ? main.indexOf('"user-data-dir"') : main.indexOf("'user-data-dir'")
  const firstGetPath = main.indexOf('getPath("userData")')
  check('D: in the built main, the pin comes before the first read of userData', pinAt > 0 && firstGetPath > pinAt, show({ pinAt, firstGetPath }))
})

await guard('E', async () => {
  if (process.env.SKIP_LAUNCH === '1') return
  const roaming = process.env.APPDATA
  const productFolder = join(roaming, 'Frontier App')
  const hadProductFolder = existsSync(productFolder)
  const scratch = join('C:\\frontier-tmp', `s181-${Date.now()}`)
  mkdirSync(scratch, { recursive: true })
  const DEBUG = Number(process.env.PKG_DEBUG_PORT ?? 9241)
  const INSPECT = Number(process.env.PKG_INSPECT_PORT ?? 9242)
  const child = spawn(EXE, [`--user-data-dir=${scratch}`, `--remote-debugging-port=${DEBUG}`, `--inspect=${INSPECT}`], { stdio: 'ignore', env: { ...process.env, FRONTIER_API_BASE_URL: 'http://127.0.0.1:9' } })
  try {
    let page = null
    for (let i = 0; i < 60 && !page; i++) {
      await sleep(500)
      try { page = (await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json()).find((t) => t.type === 'page') } catch {}
    }
    check('E: the packaged program starts and shows a page', !!page, show(page?.url))
    check('E: the page is the app\'s own built file (not a dev server)', !!page && page.url.startsWith('file:///') && page.url.endsWith('/resources/app.asar/out/renderer/index.html'), page?.url)
    await sleep(1500)
    check('E: the --user-data-dir is the profile it uses (DevToolsActivePort and Local Storage there)', existsSync(join(scratch, 'DevToolsActivePort')) && existsSync(join(scratch, 'Local Storage')))
    check('E: no "Frontier App" folder appeared in Roaming', hadProductFolder || !existsSync(productFolder), productFolder)
    let inspector = false
    try { await fetch(`http://127.0.0.1:${INSPECT}/json/list`, { signal: AbortSignal.timeout(1500) }); inspector = true } catch {}
    check('E: --inspect opened no debugger', !inspector)
  } finally {
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    await sleep(1500)
  }
  console.log(`(the scratch profile stays: ${scratch})`)
})

await guard('F', async () => {
  const status = execFileSync('powershell', ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${EXE}').Status`], { encoding: 'utf8' }).trim()
  check('F: the exe is not Authenticode-signed (unsigned this stage)', status === 'NotSigned', status)
})

process.exit(check.summary() ? 0 : 1)
