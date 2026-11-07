// Stage 21.3 (D-053), Auto, under plain Node: the rules of shared/autoPick.ts with the registry and the shortlist as they are today, and with made-up
// makers and keys: only makers with a key; pictures and PDFs; "Quick answer" the cheapest; a task the makers name models for (the cheapest of those);
// otherwise the cheapest $$$ all-rounder, or the cheapest of all; no key at all; a reason in words every time.
// usage: node tools/verify-21-3.mjs
import './ts-resolve.mjs'
import { readFileSync } from 'node:fs'
import { checker } from './cdp.mjs'
import { REPO, REPO_URL } from './paths.mjs'

const { pickAuto } = await import(`${REPO_URL}/src/shared/autoPick.ts`)
const check = checker()
const registry = JSON.parse(readFileSync(`${REPO}/registry/models.json`, 'utf8'))
const rankings = JSON.parse(readFileSync(`${REPO}/registry/rankings.json`, 'utf8')).rankings
const models = registry.models.map((m) => ({ id: m.id, label: m.label, provider: m.provider, pricing: m.pricing, imageInput: m.capabilities.imageInput, documentInput: m.capabilities.documentInput }))
const providers = (keys) => ['anthropic', 'openai', 'google'].map((id) => ({ id, name: id, hasKey: keys.includes(id) }))
const suggestionsFor = (keys) => rankings.filter((r) => keys.includes(registry.models.find((m) => m.id === r.modelId)?.provider))
const pick = (keys, task, extra = {}) => pickAuto({ models, providers: providers(keys), suggestions: suggestionsFor(keys), task, pictures: false, pdfs: false, ...extra })
const all = ['anthropic', 'openai', 'google']

// The expectations are worked out HERE from the prices and the shortlist (never by the module under test).
const price = (id) => registry.models.find((m) => m.id === id).pricing
const cheapestOf = (ids) => ids.slice().sort((a, b) => price(a).outputPerMTok - price(b).outputPerMTok || price(a).inputPerMTok - price(b).inputPerMTok)[0]
const keyedIds = (keys) => registry.models.filter((m) => keys.includes(m.provider)).map((m) => m.id)
const tier3 = (keys) => keyedIds(keys).filter((id) => price(id).outputPerMTok > 5 && price(id).outputPerMTok <= 15)

let p = pick(all, 'quick')
check('A: Quick answer, every key: the cheapest model of all', p.ok && p.modelId === cheapestOf(keyedIds(all)) && /cheapest/.test(p.reason), JSON.stringify(p))
p = pick(['anthropic'], 'quick')
check('A: Quick answer, Anthropic\'s key only: the cheapest Anthropic model', p.ok && p.modelId === cheapestOf(keyedIds(['anthropic'])), JSON.stringify(p))
for (const task of ['coding', 'writing']) {
  for (const keys of [all, ['anthropic'], ['openai'], ['anthropic', 'openai']]) {
    const named = rankings.filter((r) => r.task === task).map((r) => r.modelId).filter((id) => keyedIds(keys).includes(id))
    p = pick(keys, task)
    const want = named.length > 0 ? cheapestOf(named) : (tier3(keys).length > 0 ? cheapestOf(tier3(keys)) : cheapestOf(keyedIds(keys)))
    check(`B: ${task}, keys ${keys.join('+')}: ${want}`, p.ok && p.modelId === want, JSON.stringify(p))
    if (named.length > 0) check(`B: ...and the reason names the task (${task})`, p.reason.includes(`names for ${task}`))
  }
}
p = pick(all, null)
check('C: no task: the cheapest $$$ all-rounder', p.ok && p.modelId === cheapestOf(tier3(all)) && /balanced/.test(p.reason), JSON.stringify(p))
p = pick(['google'], 'chat')
const want = tier3(['google']).length > 0 ? cheapestOf(tier3(['google'])) : cheapestOf(keyedIds(['google']))
check('C: a task with nothing named for the keyed makers (chat, Google only): the rule for no task', p.ok && p.modelId === want, JSON.stringify(p))
p = pickAuto({ models: models.filter((m) => m.id === 'gpt-6-luna'), providers: providers(['openai']), suggestions: [], task: null, pictures: false, pdfs: false })
check('C: no $$$ model at all: the cheapest there is', p.ok && p.modelId === 'gpt-6-luna' && /cheapest model you have a key for/.test(p.reason))

p = pick([], 'coding')
check('D: no key at all: nothing picked, and it says to add a key', !p.ok && /add an API key/.test(p.reason))
// The cheapest model of all made blind: a picture must move the pick to the cheapest model that still reads pictures.
const cheapestAll = cheapestOf(keyedIds(all))
const blind = models.map((m) => (m.id === cheapestAll ? { ...m, imageInput: false } : m))
const seeing = cheapestOf(keyedIds(all).filter((id) => id !== cheapestAll))
p = pickAuto({ models: blind, providers: providers(all), suggestions: suggestionsFor(all), task: 'quick', pictures: true, pdfs: false })
check(`D: a picture on the message, the cheapest model (${cheapestAll}) blind: the cheapest that reads pictures (${seeing})`, p.ok && p.modelId === seeing, JSON.stringify(p))
p = pickAuto({ models: blind, providers: providers(all), suggestions: suggestionsFor(all), task: 'quick', pictures: false, pdfs: false })
check('D: ...and without a picture the blind one is still picked', p.ok && p.modelId === cheapestAll)
p = pickAuto({ models: models.map((m) => ({ ...m, documentInput: false })), providers: providers(all), suggestions: [], task: null, pictures: false, pdfs: true })
check('D: a PDF and no model that reads PDFs: nothing picked, and it says why', !p.ok && /reads what this message carries/.test(p.reason))
p = pick(['anthropic'], 'coding')
check('D: a model of a maker without a key is never picked', p.ok && registry.models.find((m) => m.id === p.modelId).provider === 'anthropic')
check('D: every pick has a reason in words', [pick(all, 'quick'), pick(all, 'coding'), pick(all, null), pick(all, 'writing')].every((x) => x.ok && x.reason.length > 10))

process.exit(check.summary() ? 0 : 1)
