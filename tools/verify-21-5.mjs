// Stage 21.5 (D-053), Search chats under plain Node: the query (shared/chatSearch.ts: 1 to 200 characters, its words, any case), the matching (every word, in
// the title or a message), the order (newest first), the cap (50), the piece of text around what was found (160 characters at most, "..." where cut, on one
// line), and source checks that main searches the chats it can read and hands the page titles and pieces only.
// usage: node tools/verify-21-5.mjs
import './ts-resolve.mjs'
import { readFileSync } from 'node:fs'
import { checker } from './cdp.mjs'
import { REPO, REPO_URL } from './paths.mjs'

const { checkSearchQuery, searchConversations, snippetAround, SEARCH_LIMITS } = await import(`${REPO_URL}/src/shared/chatSearch.ts`)
const check = checker()

check('A: the limits: 200 characters, 50 results, 160 characters of text', SEARCH_LIMITS.maxQueryChars === 200 && SEARCH_LIMITS.maxResults === 50 && SEARCH_LIMITS.snippetChars === 160)
check('A: a query is read as its words, in lower case, each once', JSON.stringify(checkSearchQuery('  Rainbow   COLOURS rainbow ').words) === '["rainbow","colours"]')
for (const bad of ['', '   ', 'x'.repeat(201), 42, null, ['a'], { q: 'a' }]) check(`A: refused: ${JSON.stringify(bad)?.slice(0, 30)}`, checkSearchQuery(bad).ok === false)
check('A: 200 characters is allowed', checkSearchQuery('a'.repeat(200)).ok === true)

const chat = (id, title, updatedAt, ...texts) => ({ id, title, updatedAt, createdAt: 0, instructions: '', messages: texts.map((content, i) => ({ role: i % 2 ? 'assistant' : 'user', content, status: 'done' })) })
const chats = [
  chat('a', 'Trip to Goa', 300, 'Plan a 3 day trip', 'Day one: the beaches of North Goa...'),
  chat('b', 'Inflation basics', 200, 'Explain inflation simply', 'Inflation is when prices rise over time.'),
  chat('c', 'Rainbows', 400, 'What is a rainbow?', 'A rainbow is light bent in drops of rain.'),
  chat('d', 'Old trip notes', 100, 'notes about a TRIP to Kerala')
]
const ids = (words) => searchConversations(chats, checkSearchQuery(words).words).map((h) => h.id)
check('B: a word in a message finds the chat, any case', JSON.stringify(ids('KERALA')) === '["d"]')
check('B: a word in the title finds it', JSON.stringify(ids('basics')) === '["b"]')
check('B: every word must be there (one in the title, one in a message counts)', JSON.stringify(ids('goa beaches')) === '["a"]' && JSON.stringify(ids('goa kerala')) === '[]')
check('B: the newest first', JSON.stringify(ids('trip')) === '["a","d"]' && JSON.stringify(ids('a')) === '["c","a","b","d"]')
check('B: nothing found: an empty list', JSON.stringify(ids('volcano')) === '[]')
const many = Array.from({ length: 80 }, (_, i) => chat(`m${i}`, `Chat ${i}`, i, 'the same word'))
const capped = searchConversations(many, ['word'])
check('B: at most 50, the newest', capped.length === 50 && capped[0].id === 'm79' && capped[49].id === 'm30')
const hit = searchConversations(chats, ['bent'])[0] ?? {}
check('C: a hit carries the id, the title, the date and a piece of the text, and nothing else', JSON.stringify(Object.keys(hit).sort()) === '["id","snippet","title","updatedAt"]' && hit.title === 'Rainbows' && hit.snippet.includes('bent'))
check('C: only the title matched: no piece of text', searchConversations(chats, ['basics'])[0]?.snippet === '')
const long = 'x '.repeat(200) + 'NEEDLE' + ' y'.repeat(200)
const piece = snippetAround(long, long.indexOf('NEEDLE'), 6)
check('C: a long text is cut around what was found, with "..." on both sides, 160 characters of text at most', piece.startsWith('...') && piece.endsWith('...') && piece.includes('NEEDLE') && piece.length <= 166, `${piece.length}: ${piece.slice(0, 40)}`)
check('C: a short text is whole, with no "..."', snippetAround('just this', 5, 4) === 'just this')
check('C: on one line (line breaks and runs of spaces become one space)', snippetAround('one\n\ntwo   three', 5, 3) === 'one two three')
const start = snippetAround('NEEDLE ' + 'z'.repeat(300), 0, 6)
check('C: found at the very start: no "..." before it', start.startsWith('NEEDLE') && start.endsWith('...'))

const ipc = readFileSync(`${REPO}/src/main/ipc.ts`, 'utf8')
const handler = /CHANNELS\.historySearch,[\s\S]*?\n  \)\n/.exec(ipc)?.[0] ?? ''
check('D: main checks the query before anything is read', /const query = checkSearchQuery\(input\)\s*\n\s*if \(!query\.ok\) return query/.test(handler))
// (22.1) The reading of every chat moved into readAllChats, shared with the Library: the handler calls it, and it does what the handler did.
const readAll = /async function readAllChats\(\)[\s\S]*?\n  \}\n/.exec(ipc)?.[0] ?? ''
check('D: main searches the chats it can read (the same load as History) and counts the others', /await readAllChats\(\)/.test(handler) && /history\.list\(\)/.test(readAll) && /history\.load\(summary\.id\)/.test(readAll) && /unreadable \+= 1/.test(readAll))
check('D: the page is handed the hits (titles and pieces) only', /hits: searchConversations\(chats, query\.words\)/.test(handler) && !/conversation:/.test(handler))
check('D: the handler is guarded like the others (only the app\'s own page)', /guarded\(async \(input: unknown\): Promise<HistorySearchResult>/.test(handler))

process.exit(check.summary() ? 0 : 1)
