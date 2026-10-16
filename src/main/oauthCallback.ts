import http from 'http'
import type { AddressInfo, Socket } from 'net'
import { OAUTH_LIMITS } from '../shared/oauth'

// The listener the browser comes back to (Stage 14b, D-046, slice 14b.3; RFC 8252 section 7.3). The app has had no listener before this one, so it is as small as it can be:
//   - it listens on 127.0.0.1 ONLY (not on the name `localhost`, not on every address), on a port the system picks, and it is ready BEFORE the browser is opened;
//   - it answers GET of one exact path (`/callback`) with exactly the Host header it was opened with (a page on the web cannot reach it by a name that points here);
//     everything else gets the same plain 404;
//   - only a request that carries THIS sign-in's `state` is an answer. A request with another state, or none, is not the one waited for (a favicon, a prefetch, a hostile page):
//     it gets the 404 and the listener goes on waiting, up to twenty such requests, then it gives up;
//   - the first answer is the only one: the listener closes as soon as it has been sent, and on the clock (OAUTH_LIMITS.waitMs), on cancel, on the person's Stop;
//   - what comes back is the request's parameters, each once, each at most 2,000 characters, handed on as text and checked elsewhere (oauthFlow.ts); a parameter that
//     comes twice makes the answer unusable;
//   - the page it shows holds no word of the request (nothing is reflected), is never kept (`no-store`), sends no referrer, and its policy allows nothing.
// No Electron imports.

export interface CallbackAnswer {
  ok: true
  /** The query's parameters (code, state, iss, error, ...), each once. */
  params: Record<string, string>
}
export type CallbackEnd =
  CallbackAnswer | { ok: false; why: 'timeout' | 'cancelled' | 'stopped' | 'malformed' | 'noise' }

export interface CallbackListener {
  /** The address the provider sends the browser back to; the same text goes in the authorization request and the token request. */
  redirectUri: string
  port: number
  /** Settles once: the answer, or why there is none. The listener is closed by then. */
  done: Promise<CallbackEnd>
  /** Ends the waiting (the person pressed Cancel). */
  cancel(): void
}

export interface CallbackOptions {
  /** The `state` of this sign-in. */
  state: string
  /** How long to wait; the app's limit by default. */
  ms?: number
  signal?: AbortSignal
}

const PATH = '/callback'
const MAX_PARAM = 2000
const MAX_NOISE = 20

const PAGE_OK =
  '<!doctype html><meta charset="utf-8"><title>Frontier App</title><p>You can close this window and go back to the app.</p>'
const PAGE_NOT =
  '<!doctype html><meta charset="utf-8"><title>Frontier App</title><p>This is not the answer the app is waiting for.</p>'

export function listenForCallback(options: CallbackOptions): Promise<CallbackListener> {
  return new Promise<CallbackListener>((ready, fail) => {
    const sockets = new Set<Socket>()
    let settle: (end: CallbackEnd) => void = () => undefined
    let finished = false
    let noise = 0
    const done = new Promise<CallbackEnd>((resolve) => {
      settle = (end): void => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        // let the page that answers go out first, then close
        setImmediate(() => {
          server.close()
          for (const s of sockets) s.destroy()
        })
        resolve(end)
      }
    })
    const timer = setTimeout(
      () => settle({ ok: false, why: 'timeout' }),
      options.ms ?? OAUTH_LIMITS.waitMs
    )
    const onAbort = (): void => settle({ ok: false, why: 'stopped' })

    let hostHeader = ''
    const server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
      const reply = (status: number, html: string): void => {
        res.writeHead(status, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'none'",
          'x-content-type-options': 'nosniff',
          connection: 'close'
        })
        res.end(html)
      }
      const notTheAnswer = (): void => {
        reply(404, PAGE_NOT)
        if (++noise > MAX_NOISE) settle({ ok: false, why: 'noise' })
      }
      if (finished || req.method !== 'GET' || req.headers.host !== hostHeader) return notTheAnswer()
      let url: URL
      try {
        url = new URL(req.url ?? '/', `http://${hostHeader}`)
      } catch {
        return notTheAnswer()
      }
      if (url.pathname !== PATH) return notTheAnswer()
      const states = url.searchParams.getAll('state')
      if (states.length !== 1 || states[0] !== options.state) return notTheAnswer()
      // it is this sign-in's answer: whatever is wrong with it now makes the sign-in fail, it is not waited for again
      const params: Record<string, string> = {}
      for (const key of new Set(url.searchParams.keys())) {
        const values = url.searchParams.getAll(key)
        if (values.length !== 1 || values[0].length > MAX_PARAM || key.length > 40) {
          reply(400, PAGE_NOT)
          return settle({ ok: false, why: 'malformed' })
        }
        params[key] = values[0]
      }
      reply(200, PAGE_OK)
      settle({ ok: true, params })
    })
    server.on('connection', (s) => {
      sockets.add(s)
      s.on('close', () => sockets.delete(s))
    })
    server.on('error', (error) => {
      if (!finished) fail(error)
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      hostHeader = `127.0.0.1:${port}`
      if (options.signal?.aborted === true) {
        settle({ ok: false, why: 'stopped' })
      } else {
        options.signal?.addEventListener('abort', onAbort, { once: true })
      }
      ready({
        redirectUri: `http://${hostHeader}${PATH}`,
        port,
        done,
        cancel: () => settle({ ok: false, why: 'cancelled' })
      })
    })
  })
}
