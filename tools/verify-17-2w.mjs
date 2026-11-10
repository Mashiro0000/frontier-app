// Slice 17.2 (D-049) in the real window, against the mock: what the rules of the third provider change in the app as it runs, before its adapter exists (17.3).
// What it shows:
//   A. main tells the page of three providers (Google with no key) and eight models; Gemini's two carry today's prices and the change that is coming, the others none;
//   B. Settings has a section for a Google key, made from that list (no change to the page was needed), and the model list shows Gemini's prices;
//   C. the model menu offers the two Gemini models; a Gemini model chosen with no Google key says so, names Google, and sends nothing to any provider;
//   D. the page logged nothing.
// Needs: USER_DATA_DIR (scratch), MOCK_PORT.
import './temp-on-a.mjs'
import './ts-resolve.mjs'
import { connect, checker, sleep } from './cdp.mjs'
import { assertScratchProfile } from './profile-guard.mjs'
import { helpers } from './lib3.mjs'

const port = Number(process.argv[3] ?? 9222)
const userData = process.env.USER_DATA_DIR
const mockUrl = `http://127.0.0.1:${process.env.MOCK_PORT}`
if (!userData || !process.env.MOCK_PORT) throw new Error('USER_DATA_DIR and MOCK_PORT must be set')
const check = checker()
const part = async (name, fn) => { try { await fn() } catch (error) { check(`${name} did not run to its end: ${String(error?.stack ?? error).slice(0, 500)}`, false) } }
const show = (v) => JSON.stringify(v)?.slice(0, 600)
const page = await connect(port)
await assertScratchProfile()
const H = helpers(page, { userData, mockUrl })
const ev = (expression) => page.evaluate(expression)
const today = new Date()
const beforeDecember = today.getTime() < new Date(2026, 11, 1).getTime()

try {
  await fetch(`${mockUrl}/__reset`, { method: 'POST' })
  await part('A', async () => {
    const s = await H.status()
    check('A: three providers, in order; Google is "Google" and has no key', s.providers.map((p) => `${p.id}:${p.name}:${p.hasKey}`).join() === 'anthropic:Anthropic:false,openai:OpenAI:false,google:Google:false', show(s.providers))
    check('A: eight models, the two Gemini models last', s.models.map((m) => m.id).join() === 'claude-fable-5-1,claude-opus-5-5,claude-sonnet-5-5,gpt-6-astra,gpt-6.1-sol,gpt-6-luna,gemini-4-argon,gemini-3.8-flash', show(s.models.map((m) => m.id)))
    const argon = s.models.find((m) => m.id === 'gemini-4-argon')
    const flash = s.models.find((m) => m.id === 'gemini-3.8-flash')
    if (beforeDecember) {
      check('A: Gemini 4 Argon today: $2 in, $10 out; the change of 1 December 2026 to $4 / $20 is told', argon.pricing.inputPerMTok === 2 && argon.pricing.outputPerMTok === 10 && argon.priceChange?.from === '2026-12-01' && argon.priceChange.pricing.outputPerMTok === 20, show(argon))
      check('A: Gemini 3.8 Flash today: $0.75 / $3.75; the change of 1 January 2027 is told', flash.pricing.inputPerMTok === 0.75 && flash.priceChange?.from === '2027-01-01' && flash.priceChange.pricing.inputPerMTok === 1.5, show(flash))
    } else console.log(`   (this run is on ${today.toISOString().slice(0, 10)}, after 1 December 2026: the price checks of A are for October and November)`)
    check('A: no other model has a change coming', s.models.filter((m) => m.provider !== 'google').every((m) => m.priceChange === null))
    check('A: the page is told nothing about how a model is called (each model has exactly the nine fields of a model option)', s.models.every((m) => Object.keys(m).sort().join() === 'contextWindow,description,documentInput,id,imageInput,label,priceChange,pricing,provider'), show(s.models.map((m) => Object.keys(m).join())))
    check('A: the default is still Claude Opus 5.5', s.selectedModelId === 'claude-opus-5-5')
  })

  await part('B', async () => {
    const text = await H.settingsText()
    check('B: Settings has a section for a Google key, saying what it is for and where to make one', /Google/.test(text) && /Google's Gemini models/.test(text) && /Google AI Studio/.test(text), show(text.slice(0, 2000)))
    check('B: the three key sections are there, Anthropic, OpenAI and Google, in that order', /Anthropic[\s\S]*OpenAI[\s\S]*Google/.test(text))
    await H.chooseInPage('gemini-4-argon')
    await H.settle('gemini-4-argon')
    const chosen = await H.settingsText()
    const line = chosen.match(/Gemini 4 Argon, from Google[\s\S]{0,600}/)?.[0] ?? chosen.slice(0, 1500)
    check('B: with Gemini 4 Argon chosen, Settings names it "from Google", with its description and today\'s list price, billed to the Google account', /Gemini 4 Argon, from Google/.test(chosen) && /most capable/.test(line) && (!beforeDecember || /\$2(\.00)? in, \$10(\.00)? out per million tokens/.test(line)), show(line))
    await H.chooseInPage('claude-opus-5-5')
    await H.settle('claude-opus-5-5')
  })

  await part('C', async () => {
    const menu = await H.menu()
    check('C: the model menu offers both Gemini models', menu.values.includes('gemini-4-argon') && menu.values.includes('gemini-3.8-flash'), show(menu))
    await H.chooseInPage('gemini-3.8-flash')
    await H.settle('gemini-3.8-flash')
    const before = (await H.mockReqs()).length
    await H.send('hello Gemini')
    await page.waitFor(`[...document.querySelectorAll('.message-assistant')].some((m) => /API key/.test(m.innerText))`, { timeoutMs: 8000 })
    const said = await H.lastAssistant('a.innerText')
    check('C: with no Google key, the reply says so and names Google', /No API key is saved yet\. Open Settings and add your Google API key\./.test(said), show(said))
    await sleep(300)
    check('C: nothing was sent to any provider', (await H.mockReqs()).length === before)
    await H.chooseInPage('claude-opus-5-5')
    await H.settle('claude-opus-5-5')
  })

  await part('D', async () => {
    check('D: the page logged no error or warning', page.problems.length === 0, show(page.problems))
  })
} finally {
  const ok = check.summary()
  process.exit(ok ? 0 : 1)
}
