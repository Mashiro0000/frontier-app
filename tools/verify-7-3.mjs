// Slice 7.3 (D-026), straight under Node (no window): what the conversation becomes when the person asks again, in
// src/renderer/src/chat/rewrite.ts: the last reply asked for again, and one of the person's own messages changed with everything after
// it dropped. Run: node tools/verify-7-3.mjs
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'
import { checker } from './cdp.mjs'

const check = checker()
const { withoutLastReply, laterMessages, withEditedMessage } = await import(`${REPO_URL}/src/renderer/src/chat/rewrite.ts`)

const u = (id, content = `question ${id}`, status = 'done') => ({ id, role: 'user', content, status })
const a = (id, content = `answer ${id}`, status = 'done', extra = {}) => ({ id, role: 'assistant', content, status, provider: 'anthropic', model: 'claude-opus-5-5', ...extra })
const deepFreeze = (list) => Object.freeze(list.map((m) => Object.freeze({ ...m })))
const ids = (list) => (list === null ? null : list.map((m) => m.id).join(','))

// ============ withoutLastReply ============
check('withoutLastReply: a conversation of one exchange gives the question', ids(withoutLastReply([u('u1'), a('a1')])) === 'u1')
check('...of three exchanges gives everything but the last reply', ids(withoutLastReply([u('u1'), a('a1'), u('u2'), a('a2'), u('u3'), a('a3')])) === 'u1,a1,u2,a2,u3')
check('...a reply that was stopped, or failed, can be asked for again too', ids(withoutLastReply([u('u1'), a('a1', 'part', 'stopped')])) === 'u1' && ids(withoutLastReply([u('u1'), a('a1', '', 'error', { error: 'x' })])) === 'u1')
check('...an empty reply can be asked for again', ids(withoutLastReply([u('u1'), a('a1', '', 'done')])) === 'u1')
check('withoutLastReply: a reply that is still arriving cannot be replaced', withoutLastReply([u('u1'), a('a1', 'par', 'streaming')]) === null)
check('...a conversation that ends with the person\'s message has no reply to replace', withoutLastReply([u('u1')]) === null && withoutLastReply([u('u1'), a('a1'), u('u2')]) === null)
check('...an empty conversation has none', withoutLastReply([]) === null)
check('...a conversation that begins with a reply (nothing was asked) has nothing to send', withoutLastReply([a('a1')]) === null)
check('...two replies in a row (not what the app makes) leave nothing to send', withoutLastReply([u('u1'), a('a1'), a('a2')]) === null)
{
  const list = deepFreeze([u('u1'), a('a1'), u('u2'), a('a2')])
  let out, threw = ''
  try { out = withoutLastReply(list) } catch (e) { threw = String(e) }
  check('...it never changes what it is given (frozen input), and hands back a new list holding the very same messages', threw === '' && out !== list && out?.length === 3 && out.every((m, i) => m === list[i]) && list.length === 4, threw)
}
check('...the last reply is the only thing dropped: a reply from another model earlier stays', (() => { const out = withoutLastReply([u('u1'), a('a1', 'x', 'done', { model: 'gpt-6-astra', provider: 'openai' }), u('u2'), a('a2')]); return out?.[1]?.model === 'gpt-6-astra' })())

// ============ laterMessages ============
{
  const conv = [u('u1'), a('a1'), u('u2'), a('a2'), u('u3'), a('a3')]
  check('laterMessages: the first question has five after it, the second three, the last one (the reply)', laterMessages(conv, 'u1') === 5 && laterMessages(conv, 'u2') === 3 && laterMessages(conv, 'u3') === 1)
  check('...a reply, or an id that is not in the conversation, is not editable', laterMessages(conv, 'a1') === null && laterMessages(conv, 'nope') === null && laterMessages(conv, '') === null)
  check('...a question with no reply after it has none after it', laterMessages([u('u1')], 'u1') === 0)
  check('...hostile ids do not match anything and do not throw', ['__proto__', 'constructor', 'toString', 5, null, undefined, {}, []].every((id) => { try { return laterMessages(conv, id) === null } catch { return false } }))
}

// ============ withEditedMessage ============
{
  const conv = [u('u1', 'first'), a('a1'), u('u2', 'second'), a('a2'), u('u3', 'third'), a('a3')]
  const e1 = withEditedMessage(conv, 'u1', 'first, but different')
  check('withEditedMessage: editing the first question gives only that question, changed (everything after it is dropped)', ids(e1) === 'u1' && e1[0].content === 'first, but different')
  const e2 = withEditedMessage(conv, 'u2', 'second!')
  check('...editing a middle one keeps what is before it', ids(e2) === 'u1,a1,u2' && e2[0] === conv[0] && e2[1] === conv[1] && e2[2].content === 'second!')
  const e3 = withEditedMessage(conv, 'u3', 'third!')
  check('...editing the last question drops only its reply', ids(e3) === 'u1,a1,u2,a2,u3' && e3.at(-1).content === 'third!')
  check('...the edited message keeps its id, its role and its status (so the page keeps its place)', e2[2].id === 'u2' && e2[2].role === 'user' && e2[2].status === 'done')
  check('...the new text is trimmed', withEditedMessage(conv, 'u1', '  spaced \n ')?.[0]?.content === 'spaced')
  check('...inner spaces and line breaks of the text are kept as typed', withEditedMessage(conv, 'u1', 'a  b\nc   d')?.[0]?.content === 'a  b\nc   d')
  check('...empty or white-space-only text is refused', withEditedMessage(conv, 'u1', '') === null && withEditedMessage(conv, 'u1', ' \n\t ') === null)
  check('...a reply cannot be edited, nor an id that is not there', withEditedMessage(conv, 'a1', 'x') === null && withEditedMessage(conv, 'zzz', 'x') === null)
  check('...nothing is changed while a reply is arriving', withEditedMessage([u('u1'), a('a1', 'par', 'streaming')], 'u1', 'x') === null)
  const frozen = deepFreeze(conv)
  let out, threw = ''
  try { out = withEditedMessage(frozen, 'u2', 'x') } catch (e) { threw = String(e) }
  check('...it never changes what it is given (frozen input), and the original message is untouched', threw === '' && frozen[2].content === 'second' && out?.[2] !== frozen[2] && frozen.length === 6, threw)
  check('...hostile ids and texts are refused, never thrown at', [['__proto__', 'x'], ['u1', undefined], ['u1', null], ['u1', 5], ['u1', {}], ['u1', ['x']], [undefined, 'x'], [5, 'x']].every(([id, text]) => { try { return withEditedMessage(conv, id, text) === null } catch { return false } }))
  check('...an edited message that was stopped or failed before is sent as a normal question', withEditedMessage([u('u1'), a('a1', '', 'error', { error: 'x' })], 'u1', 'again')?.at(-1)?.status === 'done')
}

process.exit(check.summary() ? 0 : 1)
