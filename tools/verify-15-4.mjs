// Slice 15.4 under plain Node (no window): the gate for the microphone as the session's permission rules (D-047). Every permission Electron knows, every shape of media request, the
// gate open and closed, the right window and a wrong one, the app's page and another; the played session that main installs the rules on; the title and the dot that tell the person the
// microphone is on; and what the source must keep true (nothing answers a permission but these rules; the window is made with its title and cannot be renamed by the page). The window
// itself, with a fake microphone, is in verify-15-5w.mjs (15.5), where the whole path (the switch, the key, the limits, the hold) is real.
// Run: node tools/guarded.mjs tools/verify-15-4.mjs      (ONLY=A,C runs some parts)
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, REPO_URL } from './paths.mjs'

const check = checker()
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
const guard = async (name, fn) => { if (ONLY && !ONLY.has(name)) return; try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 400)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 400)
const SRC = `${REPO_URL}/src`
const P = await import(`${SRC}/main/voicePermissions.ts`)
const G = await import(`${SRC}/main/voiceGate.ts`)
const source = (rel) => readFileSync(join(REPO, rel), 'utf8')

const APP = 'file:///A:/frontier-app/out/renderer/index.html'
const DEV = 'http://localhost:5173/'
const isApp = (appUrl) => (url) => url === appUrl || url === appUrl + '#x'
/** Every permission name the installed Electron's types list (electron.d.ts, setPermissionRequestHandler), plus a few that are not. */
const PERMISSIONS = ['ar', 'automatic-fullscreen', 'background-fetch', 'background-sync', 'captured-surface-control', 'clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read', 'display-capture', 'fileSystem', 'fullscreen', 'geolocation', 'geolocation-approximate', 'hand-tracking', 'hid', 'idle-detection', 'keyboardLock', 'local-fonts', 'local-network', 'local-network-access', 'loopback-network', 'media', 'mediaKeySystem', 'midi', 'midiSysex', 'nfc', 'notifications', 'openExternal', 'payment-handler', 'periodic-background-sync', 'persistent-storage', 'pointerLock', 'screen-wake-lock', 'sensors', 'serial', 'smart-card', 'speaker-selection', 'storage-access', 'system-wake-lock', 'top-level-storage-access', 'usb', 'vr', 'web-app-installation', 'web-printing', 'window-management', 'unknown']
const good = (over = {}) => ({ kind: 'request', permission: 'media', mediaTypes: ['audio'], requestingUrl: APP, isMainFrame: true, fromMainWindow: true, ...over })
const ctx = (mayRecord, appUrl = APP) => ({ mayRecord, isApp: isApp(appUrl) })

// ============ A. the rules ============
await guard('A', async () => {
  const yes = (ask, open = true, appUrl = APP) => P.permissionAllowed(ask, ctx(open, appUrl))
  check('A: the list of permissions is the installed Electron\'s (47 names, so a new one is noticed when Electron is updated)', (() => { const d = readFileSync(join(REPO, 'node_modules/electron/electron.d.ts'), 'utf8'); const m = /setPermissionRequestHandler\(handler: \(\(webContents: WebContents, permission: ([^,]+), callback/.exec(d); const names = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]); return names.length === PERMISSIONS.length && names.every((n) => PERMISSIONS.includes(n)) })(), 'the list in this file is not Electron\'s')
  check('A: the microphone is allowed for audio only, with the gate open, from the app\'s page in its window\'s top frame', yes(good()) === true)
  check('A: ...and not with the gate closed', yes(good(), false) === false)
  check('A: audio AND video in one request is refused whole', yes(good({ mediaTypes: ['audio', 'video'] })) === false && yes(good({ mediaTypes: ['video', 'audio'] })) === false)
  check('A: video alone, no type at all, nothing, two of the same: refused', [['video'], [], undefined, ['audio', 'audio'], ['Audio'], ['microphone'], ['unknown']].every((mediaTypes) => yes(good({ mediaTypes })) === false), show([['video'], [], undefined]))
  const check1 = (over) => good({ kind: 'check', mediaTypes: undefined, mediaType: 'audio', ...over })
  check('A: the check before the request is answered the same way: audio yes with the gate open, no with it closed', yes(check1({})) === true && yes(check1({}), false) === false)
  check('A: a check about video, unknown or nothing is no', ['video', 'unknown', undefined, 'Audio', ''].every((mediaType) => yes(check1({ mediaType })) === false))
  check('A: not from the chat window (another window, or no document at all) is no', yes(good({ fromMainWindow: false })) === false && yes(check1({ fromMainWindow: false })) === false)
  check('A: not from the top frame (a frame inside the page) is no', yes(good({ isMainFrame: false })) === false && yes({ ...good({ permission: 'clipboard-sanitized-write', mediaTypes: undefined }), isMainFrame: false }) === false)
  const elsewhere = ['https://evil.example/', 'https://evil.example/index.html', 'about:blank', 'file:///C:/evil/index.html', 'http://localhost:5174/', 'data:text/html,hi', 'javascript:1', '', 'file:///A:/frontier-app/out/renderer/index.html.evil']
  check('A: not from any address that is not the app\'s page is no', elsewhere.every((requestingUrl) => yes(good({ requestingUrl })) === false), show(elsewhere.filter((requestingUrl) => yes(good({ requestingUrl })))))
  check('A: no address at all is no', yes(good({ requestingUrl: undefined })) === false && yes(good({ requestingUrl: null })) === false && yes(good({ requestingUrl: 7 })) === false)
  check('A: the dev server\'s page is the app\'s page when that is the app\'s address', yes(good({ requestingUrl: DEV }), true, DEV) === true && yes(good({ requestingUrl: APP }), true, DEV) === false)
  check('A: writing text to the clipboard (what Copy uses) is allowed with the gate closed too, from the app\'s page', yes(good({ permission: 'clipboard-sanitized-write', mediaTypes: undefined }), false) === true)
  check('A: ...and not from anywhere else', yes(good({ permission: 'clipboard-sanitized-write', mediaTypes: undefined, requestingUrl: 'https://evil.example/' }), false) === false && yes(good({ permission: 'clipboard-sanitized-write', mediaTypes: undefined, fromMainWindow: false }), false) === false)
  // every other name is no, in every state
  const others = PERMISSIONS.filter((p) => p !== 'media' && p !== 'clipboard-sanitized-write')
  const open = others.filter((permission) => yes(good({ permission })) || yes(good({ permission, kind: 'check' })) || yes(good({ permission, mediaTypes: ['audio', 'video'] })))
  check(`A: each of the other ${others.length} permissions is no, with the gate open and with a request that looks like a microphone's`, open.length === 0, show(open))
  check('A: so is a name nobody knows, and the names that are properties of every object', ['', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'MEDIA', 'media ', ' media', 'clipboard-read', 'Clipboard-Sanitized-Write'].every((permission) => yes(good({ permission })) === false), show(['constructor', '__proto__'].map((permission) => yes(good({ permission })))))
  check('A: the camera and the screen specifically (what 15.1 found open) are no', yes(good({ mediaTypes: ['video'] })) === false && yes(good({ permission: 'display-capture' })) === false && yes(good({ permission: 'media', mediaTypes: ['video'] }), false) === false)
})

// ============ B. the rules on a played session, with the real gate ============
function playedSession() {
  const s = { request: null, check: null, device: null, calls: [] }
  return {
    session: {
      setPermissionRequestHandler: (h) => { s.request = h; s.calls.push('request') },
      setPermissionCheckHandler: (h) => { s.check = h; s.calls.push('check') },
      setDevicePermissionHandler: (h) => { s.device = h; s.calls.push('device') }
    },
    s
  }
}
await guard('B', async () => {
  const { session, s } = playedSession()
  const gate = G.createVoiceGate()
  const chat = { name: 'the chat window\'s page' }
  const other = { name: 'some other page' }
  let current = chat
  P.installPermissionHandlers(session, APP, gate, () => current)
  check('B: the request handler, the check handler and the device handler are all set', s.calls.sort().join() === 'check,device,request', s.calls.join())
  const ask = (contents, permission, details) => new Promise((resolve) => s.request(contents, permission, resolve, details))
  const probe = (contents, permission, details) => s.check(contents, permission, 'file://', details)
  const mic = { mediaTypes: ['audio'], requestingUrl: APP, isMainFrame: true }
  check('B: with the gate closed the microphone is refused (the request and the check)', (await ask(chat, 'media', mic)) === false && probe(chat, 'media', { mediaType: 'audio', requestingUrl: APP, isMainFrame: true }) === false)
  gate.arm()
  check('B: with the gate open the chat window\'s page gets it (the request and the check)', (await ask(chat, 'media', mic)) === true && probe(chat, 'media', { mediaType: 'audio', requestingUrl: APP, isMainFrame: true }) === true)
  check('B: another page does not, nor a check from no web contents at all', (await ask(other, 'media', mic)) === false && probe(other, 'media', { mediaType: 'audio', requestingUrl: APP, isMainFrame: true }) === false && probe(null, 'media', { mediaType: 'audio', requestingUrl: APP, isMainFrame: true }) === false)
  check('B: video with it is refused while the gate is open', (await ask(chat, 'media', { ...mic, mediaTypes: ['audio', 'video'] })) === false && (await ask(chat, 'media', { ...mic, mediaTypes: ['video'] })) === false)
  check('B: a request from a frame inside the page is refused while the gate is open', (await ask(chat, 'media', { ...mic, isMainFrame: false })) === false)
  gate.close()
  check('B: when the gate closes the very next request is refused again', (await ask(chat, 'media', mic)) === false)
  current = null
  gate.arm()
  check('B: when the chat window is gone (no page), nothing is allowed even with the gate open', (await ask(chat, 'media', mic)) === false)
  gate.close()
  current = chat
  check('B: Copy still works', (await ask(chat, 'clipboard-sanitized-write', { requestingUrl: APP, isMainFrame: true })) === true)
  check('B: reading the clipboard, the location, notifications and the screen are refused', (await Promise.all(['clipboard-read', 'geolocation', 'notifications', 'display-capture', 'fullscreen', 'openExternal'].map((p) => ask(chat, p, { requestingUrl: APP, isMainFrame: true })))).every((v) => v === false))
  check('B: devices the page could ask to open (HID, USB, serial) are refused', s.device({}) === false)
  check('B: a request with no details at all is refused (not a crash)', (await ask(chat, 'media', {})) === false && (await ask(chat, 'media', undefined).catch(() => false)) === false)
})

// ============ C. the title and the dot ============
await guard('C', async () => {
  check('C: the window\'s title is "Frontier App" and says RECORDING when the microphone is on', P.titleFor(false) === 'Frontier App' && /RECORDING/.test(P.titleFor(true)) && P.titleFor(true) !== P.titleFor(false) && P.NORMAL_TITLE === 'Frontier App')
  check('C: the normal title is the page\'s own (so nothing changes for the person when the page sets it)', /<title>Frontier App<\/title>/.test(source('src/renderer/index.html')))
  const dot = P.recordingDot()
  const px = (x, y) => [...dot.subarray((y * P.DOT_SIZE + x) * 4, (y * P.DOT_SIZE + x) * 4 + 4)]
  check('C: the dot is 16 x 16 pixels of 4 bytes', dot.length === 16 * 16 * 4 && P.DOT_SIZE === 16)
  check('C: the middle is red (BGRA 28,28,216,255), the corner is clear, a pixel of the ring is white', px(8, 8).join() === '28,28,216,255' && px(0, 0).join() === '0,0,0,0' && px(15, 15).join() === '0,0,0,0' && (() => { for (let x = 0; x < 16; x++) if (px(x, 8).join() === '255,255,255,255') return true; return false })())
  check('C: it is the same every time', P.recordingDot().equals(dot))
})

// ============ D. the source ============
await guard('D', async () => {
  const win = source('src/main/voiceWindow.ts')
  const perm = source('src/main/voicePermissions.ts')
  const index = source('src/main/index.ts')
  check("D: the page cannot rename the window: its title changes are cancelled in main, on the WINDOW (the web contents' event of the same name does not stop the native title: found in 15.5)", /\n  window\.on\('page-title-updated', \(event\) => event\.preventDefault\(\)/.test(win) && !/webContents\.on\('page-title-updated'/.test(win))
  check('D: the taskbar dot is set and cleared with the gate, and the gate closes with the window', /setOverlayIcon\(recording \? dot : null/.test(win) && /on\('closed'[\s\S]*microphoneGate\.close\(\)/.test(win))
  check('D: the window is made with its title, and the rules are installed on the default session before the message handlers and the window', /title: 'Frontier App'/.test(index) && index.indexOf('installPermissionHandlers(') < index.indexOf('registerIpc(appUrl)') && index.indexOf('registerIpc(appUrl)') < index.indexOf('  createWindow()\n') && /session\.defaultSession/.test(index))
  check('D: the handlers are told which page is the chat window\'s, at every question (the window can be made again)', /chatWindow\?\.webContents \?\? null/.test(index))
  check('D: the handlers answer through permissionAllowed and nothing else', (perm.match(/callback\(/g) ?? []).length === 1 && /callback\(permissionAllowed\(ask, context\(\)\)\)/.test(perm) && /return permissionAllowed\(ask, context\(\)\)/.test(perm) && /setDevicePermissionHandler\(\(\) => false\)/.test(perm))
  // nothing else in the app answers a permission: the only other handler is the Review window's, which says no to everything
  const all = []
  const walk = (dir) => { for (const e of readdirSync(join(REPO, dir), { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) all.push(p) } }
  walk('src')
  const handlers = all.filter((f) => /setPermission(Request|Check)Handler|setDevicePermissionHandler/.test(source(f))).sort()
  check('D: only two files set permission handlers: the rules, and the Review window\'s deny-all', handlers.join() === 'src/main/reviewWindow.ts,src/main/voicePermissions.ts', handlers.join())
  check('D: no `callback(true)` and no `() => true` for a permission anywhere in main', !all.some((f) => /callback\(true\)|setPermission(Request|Check)Handler\(\(\) => true/.test(source(f))))
  check('D: voicePermissions.ts takes nothing from Electron at run time', !/^import (?!type)[^\n]*from 'electron'/m.test(perm))
  check('D: the page asks for the microphone only in the voice code (nothing else in the renderer opens a device)', all.filter((f) => f.startsWith('src/renderer') && /getUserMedia|getDisplayMedia|enumerateDevices/.test(source(f))).every((f) => f.startsWith('src/renderer/src/voice/')))
})

const ok = check.summary()
process.exit(ok ? 0 : 1)
