// Stage 23.8 (D-055), reordering under plain Node: moveTo (one item to a place, the rest in order; anything else refused), orderOf (a saved order made
// usable: unknown and repeated ids dropped, missing ones added at the end), My experts moved on a real folder, and the wiring.
// usage: node tools/guarded.mjs tools/verify-23-8.mjs   (writes only in its own temp folder)
import './ts-resolve.mjs'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checker } from './cdp.mjs'
import { REPO_URL } from './paths.mjs'

const check = checker()
const { moveTo, orderOf } = await import(`${REPO_URL}/src/shared/order.ts`)
const L = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
const ids = (list) => list?.map((x) => x.id).join('') ?? null

check('A: down by one', ids(moveTo(L, 'a', 1)) === 'bacd')
check('A: to the end and to the start', ids(moveTo(L, 'b', 3)) === 'acdb' && ids(moveTo(L, 'd', 0)) === 'dabc')
check('A: to its own place: the same order', ids(moveTo(L, 'c', 2)) === 'abcd')
check('A: the list itself is not changed', ids(L) === 'abcd')
for (const [what, id, to] of [['an unknown id', 'x', 0], ['a place past the end', 'a', 4], ['a negative place', 'a', -1], ['a fraction', 'a', 1.5], ['a word', 'a', 'first'], ['no place', 'a', undefined], ['an id that is not text', 1, 0]]) {
  check(`A: refused: ${what}`, moveTo(L, id, to) === null)
}
const KNOWN = ['studio', 'experts', 'projects', 'library', 'history', 'tools']
check('B: nothing saved: the first order', orderOf(null, KNOWN).join() === KNOWN.join())
check('B: a saved order is kept', orderOf(['tools', 'studio', 'experts', 'projects', 'library', 'history'], KNOWN).join() === 'tools,studio,experts,projects,library,history')
check('B: an unknown id and a repeat are dropped, a missing page comes last', orderOf(['tools', 'gone', 'tools', 'studio'], KNOWN).join() === 'tools,studio,experts,projects,library,history')
check('B: anything that is not a list gives the first order', orderOf('tools', KNOWN).join() === KNOWN.join() && orderOf({ 0: 'tools' }, KNOWN).join() === KNOWN.join() && orderOf([1, null], KNOWN).join() === KNOWN.join())

{
  const { createMyExperts } = await import(`${REPO_URL}/src/main/myExperts.ts`)
  const dir = mkdtempSync(join(tmpdir(), 'frontier-238-'))
  const ex = createMyExperts({ folder: () => dir, writeMode: async () => ({ form: 'plain' }), savedKeys: async () => [] })
  for (const name of ['One', 'Two', 'Three']) await ex.save({ name, description: '', instructions: 'x', task: 'chat' })
  const list = (await ex.list()).experts
  const moved = await ex.move({ id: list[2].id, to: 0 })
  check('C: an expert moved to the top; the file keeps the new order', moved.ok && moved.experts.map((e) => e.name).join() === 'Three,One,Two' && JSON.parse(readFileSync(join(dir, 'experts.json'), 'utf8')).experts.map((e) => e.name).join() === 'Three,One,Two')
  const bad = await Promise.all([ex.move({ id: 'nope', to: 0 }), ex.move({ id: list[0].id, to: 3 }), ex.move(null), ex.move('x')])
  check('C: refused: an unknown id, a place outside the list, nothing, a word', bad.every((r) => r.ok === false))
  check('C: ...and nothing moved', (await ex.list()).experts.map((e) => e.name).join() === 'Three,One,Two')
}

{
  const read = (path) => readFileSync(fileURLToPath(`${REPO_URL}/${path}`), 'utf8')
  const ipc = read('src/main/ipc.ts')
  const pre = read('src/preload/index.ts')
  for (const ch of ['expertsMove', 'projectsMove']) {
    check(`D: ${ch} is handled behind the sender check`, new RegExp(`ipcMain\\.handle\\(\\s*CHANNELS\\.${ch},\\s*guarded\\(`).test(ipc))
    check(`D: ${ch} is bridged in the preload`, pre.includes(`CHANNELS.${ch}`))
  }
  const projects = read('src/main/projects.ts')
  check('D: a project is moved one change at a time, on what main can read', /function move\(input: unknown\)[\s\S]{0,400}oneAtATime\(async \(\) => \{\s*const now = await readable\(\)/.test(projects))
  check('D: the sidebar keeps its order on this computer only (localStorage, through appearance.ts)', /const PAGES_KEY = 'frontier\.pages'/.test(read('src/renderer/src/appearance.ts')))
}

process.exit(check.summary() ? 0 : 1)
