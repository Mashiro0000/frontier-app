// verify-1-2.mjs adapted to the UI as it is after slice 1.3: every send now also produces an assistant
// reply bubble, and the app refuses a new send while a reply is streaming. So: count only the user's
// bubbles, and wait for each reply to finish before the next send.
import { connect, checker, sleep } from './cdp.mjs'

const shots = process.argv[2]
const port = Number(process.argv[3] ?? 9222)
const check = checker()
const page = await connect(port)
await page.send('Page.reload')
await sleep(1500)

const USER = '.message-user .bubble'
const value = () => page.evaluate(`document.querySelector('.composer-input').value`)
const bubbles = () => page.evaluate(`[...document.querySelectorAll('${USER}')].map((b) => b.innerText)`)
const userCount = (n) => page.waitFor(`document.querySelectorAll('${USER}').length === ${n}`)
const settled = () => page.waitFor(`!document.querySelector('.composer-button-stop') && !document.querySelector('.typing')`, { timeoutMs: 15000, label: 'reply finished' })
const selectAll = () => page.evaluate(`document.querySelector('.composer-input').select()`)
const active = () => page.evaluate(`document.activeElement?.className`)
const sendDisabled = () => page.evaluate(`document.querySelector('.composer-button').disabled`)
const list = (expr) => page.evaluate(`(() => { const l = document.querySelector('.message-list'); return ${expr} })()`)

// 1. Enter sends
await page.type('Hello')
await page.press('Enter')
await userCount(1)
check('Enter sends: one user bubble with the text', JSON.stringify(await bubbles()) === '["Hello"]', JSON.stringify(await bubbles()))
check('an assistant reply bubble appears too', await page.evaluate(`document.querySelectorAll('.message-assistant').length === 1`))
check('input is cleared after sending', (await value()) === '')
check('focus stays in the input after sending', (await active()) === 'composer-input')
check('Send is unavailable right after sending (Stop while the reply streams)', await page.evaluate(`!document.querySelector('.composer-button:not(.composer-button-stop)') || document.querySelector('.composer-button').disabled`))
check('empty-state hint is gone once there is a message', (await page.evaluate(`!document.querySelector('.empty-state')`)))
check('user bubble is right-aligned', await page.evaluate(`(() => { const m = document.querySelector('.message-user').getBoundingClientRect(); const l = document.querySelector('.message-list-inner').getBoundingClientRect(); return Math.abs(m.right - l.right) < 2 })()`))
check('message text is selectable (user-select not none)', await page.evaluate(`getComputedStyle(document.querySelector('.bubble')).userSelect !== 'none'`))
await settled()
check('Send is disabled again once the reply is done (empty box)', (await sendDisabled()) === true)

// 2. Shift+Enter adds a line and does not send
await page.type('a')
await page.press('Enter', { shift: true })
await page.type('b')
check('Shift+Enter inserts a newline', (await value()) === 'a\nb', JSON.stringify(await value()))
check('Shift+Enter did not send', (await bubbles()).length === 1)
await page.press('Enter')
await userCount(2)
const two = await bubbles()
check('multi-line message keeps its line break', two[1] === 'a\nb', JSON.stringify(two[1]))
const heights = await page.evaluate(`[...document.querySelectorAll('${USER}')].map((b) => b.offsetHeight)`)
check('two-line bubble is taller than one-line bubble', heights[1] > heights[0], JSON.stringify(heights))
await settled()

// 3. Whitespace only does nothing
await page.type('   ')
await page.press('Enter')
await sleep(150)
check('whitespace-only message is not sent', (await bubbles()).length === 2)

// 4. Trimming (select-all replaces the whitespace)
await selectAll()
await page.type('  spaced out  ')
await page.press('Enter')
await userCount(3)
check('leading/trailing spaces are trimmed', (await bubbles())[2] === 'spaced out', JSON.stringify((await bubbles())[2]))
await settled()

// 5. Mouse click on Send, focus returns to the input
await page.type('via click')
await page.click('.composer-button')
await userCount(4)
check('clicking Send sends', (await bubbles())[3] === 'via click')
check('focus returns to the input after a mouse click on Send', (await active()) === 'composer-input', await active())
await settled()

// 6. Pasted HTML is shown as text, never run
const evil = `<img src=x onerror="document.title='pwned'"> <b>bold</b>`
await page.type(evil)
await page.press('Enter')
await userCount(5)
await settled()
await sleep(300)
check('HTML in a message is displayed literally', (await bubbles())[4] === evil, JSON.stringify((await bubbles())[4]))
check('the echoed HTML is literal too (reply bubble)', await page.evaluate(`[...document.querySelectorAll('.message-assistant .bubble')].at(-1).innerText === ${JSON.stringify('Echo: ' + evil)}`))
check('no <img>/<b> elements were created inside bubbles', await page.evaluate(`document.querySelectorAll('.bubble img, .bubble b').length === 0`))
check('onerror did not run (title unchanged)', (await page.evaluate('document.title')) === 'Frontier App')

// 7. A very long unbroken word wraps inside the bubble
await page.type('x'.repeat(600))
await page.press('Enter')
await userCount(6)
await settled()
await sleep(100)
// (D-051) the person's messages are bubbles of at most 85% of the column; a reply is the page's own text and may take the whole column
const wrap = await page.evaluate(`(() => { const all = [...document.querySelectorAll('.bubble')]; const l = document.querySelector('.message-list'); const over = all.some((b) => b.scrollWidth > b.clientWidth); const widest = Math.max(...[...document.querySelectorAll('.message-user .bubble')].map((b) => b.offsetWidth)); const widestReply = Math.max(...[...document.querySelectorAll('.message-assistant .bubble')].map((b) => b.offsetWidth)); return { bubbleOverflow: over, listOverflow: l.scrollWidth > l.clientWidth, widest, widestReply, colW: document.querySelector('.message-list-inner').offsetWidth } })()`)
check('600-char word wraps in both the message and its echo (no horizontal overflow)', !wrap.bubbleOverflow && !wrap.listOverflow, JSON.stringify(wrap))
check('no bubble of the person\'s is wider than 85% of the column, and no reply wider than the column', wrap.widest <= wrap.colW * 0.85 + 1 && wrap.widestReply <= wrap.colW + 1, JSON.stringify(wrap))

// 8. Many messages: list scrolls and stays at the bottom
for (let i = 1; i <= 14; i++) {
  await page.type(`message number ${i}`)
  await page.press('Enter')
  await userCount(6 + i)
  await settled()
}
await sleep(100)
check('list is scrollable with many messages', await list(`l.scrollHeight > l.clientHeight`))
check('list auto-scrolls to the newest message', await list(`l.scrollHeight - l.scrollTop - l.clientHeight < 2`), await list(`l.scrollHeight - l.scrollTop - l.clientHeight`))
check('breathing room under the last bubble (>= 19px)', await page.evaluate(`(() => { const l = document.querySelector('.message-list').getBoundingClientRect(); const b = [...document.querySelectorAll('.bubble')].at(-1).getBoundingClientRect(); return l.bottom - b.bottom >= 19 })()`))
check('page itself still does not scroll', await page.evaluate(`document.documentElement.scrollHeight <= innerHeight`))
await page.screenshot(`${shots}/1-2b-many.png`)

// 9. Scrolled-up reader is not yanked; sending jumps back down
await page.evaluate(`document.querySelector('.message-list').scrollTop = 0`)
await sleep(100)
check('scrolled to top stays at top (no forced scrolling)', await list(`l.scrollTop === 0`))
await page.screenshot(`${shots}/1-2b-top.png`)
await page.type('jump back down')
await page.press('Enter')
await userCount(21)
await sleep(100)
check('sending a message scrolls to the bottom even from the top', await list(`l.scrollHeight - l.scrollTop - l.clientHeight < 2`))
await settled()

// 10. Enter that confirms an IME candidate must not send
const before = (await bubbles()).length
await page.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 })
await page.press('Enter')
await sleep(150)
check('Enter during IME composition does not send', (await bubbles()).length === before, `bubbles ${before} -> ${(await bubbles()).length}`)
await page.type('に') // commit the composition
await page.press('Enter')
await userCount(before + 1)
check('after the composition is committed, Enter sends', (await bubbles()).at(-1) === 'に', JSON.stringify((await bubbles()).at(-1)))
await settled()

// 11. Accessibility hooks
const a11y = await page.evaluate(`({ log: document.querySelector('[role=log]')?.getAttribute('aria-label'), you: document.querySelectorAll('article[aria-label="You"]').length, assistant: document.querySelectorAll('article[aria-label="Assistant"]').length, articles: document.querySelectorAll('article').length, inputLabel: document.querySelector('.composer-input').getAttribute('aria-label') })`)
check('conversation is a labelled log region', a11y.log === 'Conversation')
check('22 articles labelled "You" and 22 labelled "Assistant", nothing else', a11y.you === 22 && a11y.assistant === 22 && a11y.articles === 44, JSON.stringify(a11y))
check('input has an accessible name', a11y.inputLabel === 'Message')

check('no console errors / warnings / exceptions', page.problems.length === 0, page.problems.join(' | '))
const ok = check.summary()
page.close()
process.exit(ok ? 0 : 1)
