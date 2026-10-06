// Stage 6 (D-023): registry/rankings.json is damaged (run62.mjs puts the damage there and restores the file). The rankings
// are optional: the app must still start, the models and the chat must work, and only the suggestions suffer: all of them
// if the file is wrong as a whole, only the broken row's if one row is.
// Needs: USER_DATA_DIR (scratch), VARIANT (whole | row), EXPECT_SUGGESTIONS (how many rows must survive with both keys).
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers, readRegistry } from './lib3.mjs'
import { randomBytes } from 'node:crypto'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const VARIANT = process.env.VARIANT
const EXPECT = Number(process.env.EXPECT_SUGGESTIONS)
if (!userData || !VARIANT || Number.isNaN(EXPECT)) throw new Error('USER_DATA_DIR, VARIANT and EXPECT_SUGGESTIONS must be set')
const check = checker()
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData })
const { ev } = H
const READY = `document.readyState === 'complete' && !!document.querySelector('.header-select, .app-badge')`
await page.waitFor(READY, { timeoutMs: 20000 })
await page.waitFor(`!!document.querySelector('.task-select')`, { timeoutMs: 10000, label: 'the Task menu' })

const fakeKey = () => 'test-' + randomBytes(24).toString('hex')
await ev(`window.api.settings.setApiKey('anthropic', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
await ev(`window.api.settings.setApiKey('openai', ${JSON.stringify(fakeKey())}).then((r) => r.ok)`)
await page.send('Page.reload')
await sleep(600)
await page.waitFor(READY, { timeoutMs: 20000 })
await page.waitFor(`!!document.querySelector('.task-select')`, { timeoutMs: 10000, label: 'the Task menu' })

const st = await ev(`window.api.settings.getStatus()`)
check(`[${VARIANT}] the app started and the models are fine: no models error, every model of the registry, one selected`, st.modelsError === null && st.models.length === readRegistry().models.length && st.selectedModelId !== null, JSON.stringify([st.modelsError, st.models.length, st.selectedModelId]))
check(`[${VARIANT}] the four tasks are still offered`, st.tasks.length === 4)
check(`[${VARIANT}] with both keys, ${EXPECT} suggestion(s) survive`, st.suggestions.length === EXPECT, `${st.suggestions.length}: ${JSON.stringify(st.suggestions.map((s) => `${s.modelId}:${s.task}`))}`)
if (VARIANT === 'row') {
  check('[row] the one broken row (Opus, coding) is the one that is missing; the others are all there', !st.suggestions.some((s) => s.modelId === 'claude-opus-5-5') && st.suggestions.some((s) => s.modelId === 'claude-sonnet-5-5') && st.suggestions.some((s) => s.modelId === 'gpt-6.1-sol'))
}
await ev(`(() => { const s = document.querySelector('.task-select'); s.value = 'coding'; s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
await sleep(200)
const labels = await ev(`[...document.querySelector('.header-select').options].map((o) => o.textContent)`)
const marks = labels.filter((l) => /\(suggested\)$/.test(l)).length
check(`[${VARIANT}] the model menu shows ${VARIANT === 'whole' ? 'no marks' : 'marks for the surviving coding rows'}, and the page does not break`, VARIANT === 'whole' ? marks === 0 : marks === 3, `${marks} marked: ${JSON.stringify(labels)}`)
check(`[${VARIANT}] choosing a model still works`, await (async () => {
  const other = st.models.find((m) => m.id !== st.selectedModelId).id
  return (await ev(`window.api.settings.setModel(${JSON.stringify(other)}).then((r) => r.ok && r.status.selectedModelId)`)) === other
})())
check(`[${VARIANT}] no page exceptions`, page.problems.length === 0, JSON.stringify(page.problems.slice(0, 3)))

const passed = check.summary()
process.exit(passed ? 0 : 1)
