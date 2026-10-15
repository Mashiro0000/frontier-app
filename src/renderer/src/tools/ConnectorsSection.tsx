import { useCallback, useEffect, useState } from 'react'
import {
  CONNECTOR_LIMITS,
  type ConnectorChangeResult,
  type ConnectorsStatus,
  type ConnectorView
} from '../../../shared/connectors'

const NO_ANSWER = 'the app did not answer'
const ASKING = 'Answer the question in the Windows message box...'

type Notice = { kind: 'ok' | 'error'; text: string }

interface ConnectorsSectionProps {
  /** Another request of this page is out: nothing else is started meanwhile. */
  busy: boolean
  /** Tells the page that a request is out, so that Escape does not close it while an answer is still to come. */
  working: (on: boolean) => void
}

const STATE_WORDS: Readonly<Record<ConnectorView['state'], string>> = {
  stopped: 'Stopped (it starts when it is needed)',
  starting: 'Starting...',
  running: 'Running',
  failed: 'Not running'
}

/** The arguments as the person typed them: one per line, empty lines left out. */
const argsOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

/** One connector: what runs and where, its grants, and its tools, each with what the connector says it does. */
function ConnectorCard({
  connector,
  disabled,
  run
}: {
  connector: ConnectorView
  disabled: boolean
  run: (send: () => Promise<ConnectorChangeResult>, asks: boolean, done?: string) => Promise<boolean>
}): React.JSX.Element {
  const c = connector
  const api = window.api.connectors
  const [typed, setTyped] = useState('')
  const boxed = c.place === 'box'
  return (
    <li className="connector-card" aria-label={`Connector ${c.name}`}>
      <div className="connector-head">
        <span className="tools-switch-title">{c.name}</span>
        <span className="tools-hint">
          {STATE_WORDS[c.state]}
          {c.version !== null ? `, MCP ${c.version}` : ''}
        </span>
      </div>
      <p className="tools-hint">Where it runs: {c.where}.</p>
      <p className="connector-command" aria-label="What runs">
        {c.command}
      </p>
      {c.problem !== null && (
        <p className="tools-notice tools-notice-error" role="alert">
          {c.problem}
        </p>
      )}
      <div className="history-actions">
        <button
          type="button"
          className="history-button"
          disabled={disabled}
          onClick={() => void run(() => api.refresh(c.id), false, 'Its tools were listed.')}
        >
          Check its tools
        </button>
        {c.state === 'running' && (
          <button
            type="button"
            className="history-button"
            disabled={disabled}
            onClick={() => void run(() => api.stop(c.id), false, 'It was stopped.')}
          >
            Stop it
          </button>
        )}
        <button
          type="button"
          className="history-button"
          disabled={disabled}
          onClick={() => void run(() => api.remove(c.id), true, 'The connector was removed.')}
        >
          Remove...
        </button>
      </div>

      {c.place !== 'remote' && (
        <ul className="tools-switches" aria-label={`Grants of ${c.name}`}>
          {boxed && (
            <>
              <li className="tools-switch">
                <div className="tools-switch-text">
                  <span className="tools-switch-title">May use the network</span>
                  <span className="tools-hint">From inside the box, never this PC itself.</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.network}
                  aria-label={`${c.name} may use the network`}
                  className={`tools-toggle${c.network ? ' tools-toggle-on' : ''}`}
                  disabled={disabled}
                  onClick={() => void run(() => api.setGrant(c.id, 'network', !c.network), !c.network)}
                >
                  {c.network ? 'On' : 'Off'}
                </button>
              </li>
              <li className="tools-switch">
                <div className="tools-switch-text">
                  <span className="tools-switch-title">May see a copy of the workspace folder</span>
                  <span className="tools-hint">
                    Read-only, made again at each start. An argument that begins with
                    &lt;&lt;WORKSPACE&gt;&gt; names it.
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={c.folder !== null}
                  aria-label={`${c.name} may see a copy of the workspace folder`}
                  className={`tools-toggle${c.folder !== null ? ' tools-toggle-on' : ''}`}
                  disabled={disabled}
                  onClick={() =>
                    void run(() => api.setGrant(c.id, 'workspace', c.folder === null), c.folder === null)
                  }
                >
                  {c.folder !== null ? 'On' : 'Off'}
                </button>
              </li>
            </>
          )}
          <li className="tools-switch">
            <div className="tools-switch-text">
              <span className="tools-switch-title">
                {boxed ? 'Run it NOT boxed, as you' : 'It runs NOT boxed, as you'}
              </span>
              <span className="tools-hint">
                {boxed
                  ? 'It would have every right you have. Type its name to confirm, then answer the Windows message box.'
                  : 'It has every right you have. Putting it back into the box is done at once.'}
              </span>
              {boxed && (
                <input
                  className="settings-input"
                  aria-label={`Type ${c.name} to confirm`}
                  placeholder={c.name}
                  value={typed}
                  disabled={disabled}
                  onChange={(event) => setTyped(event.target.value)}
                />
              )}
            </div>
            <button
              type="button"
              className="history-button"
              disabled={disabled || (boxed && typed !== c.name)}
              onClick={() =>
                void run(() => api.setPlace(c.id, boxed ? 'as-you' : 'box', typed), boxed)
              }
            >
              {boxed ? 'Run as me...' : 'Back into the box'}
            </button>
          </li>
        </ul>
      )}

      {c.tools.length === 0 ? (
        <p className="tools-none">
          {c.listedAt === null
            ? 'Its tools have not been listed yet: "Check its tools" starts it and asks.'
            : 'It offers no tools.'}
        </p>
      ) : (
        <ul className="connector-tools" aria-label={`Tools of ${c.name}`}>
          {c.tools.map((tool) => (
            <li key={tool.name} className="tools-switch">
              <div className="tools-switch-text">
                <span className="tools-switch-title">{tool.name}</span>
                {tool.id !== null && <span className="tools-hint">The model calls it {tool.id}.</span>}
                {tool.changed && (
                  <span className="change-warning">
                    Changed by the connector since you switched it on: read it again.
                  </span>
                )}
                <span className="connector-said">
                  What the connector says it does (not checked by the app):{' '}
                  {tool.description === '' ? '(nothing)' : tool.description}
                </span>
                {tool.args.length > 0 && (
                  <span className="tools-hint">Arguments: {tool.args.join('; ')}</span>
                )}
                {tool.readOnlyClaim && (
                  <span className="tools-hint">
                    The connector says it only reads (not checked; you are asked anyway).
                  </span>
                )}
                {tool.notOffered !== null && (
                  <span className="tools-hint">Not offered: {tool.notOffered}.</span>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={tool.on}
                aria-label={`Tool ${tool.name} of ${c.name}`}
                className={`tools-toggle${tool.on ? ' tools-toggle-on' : ''}`}
                disabled={disabled || (tool.notOffered !== null && !tool.on)}
                onClick={() => void run(() => api.setTool(c.id, tool.name, !tool.on), !tool.on)}
              >
                {tool.on ? 'On' : 'Off'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {c.moreTools && (
        <p className="tools-hint">
          It offers more tools than the app lists ({CONNECTOR_LIMITS.toolsEach} at most).
        </p>
      )}
    </li>
  )
}

/**
 * Connectors on the Tools page (D-045, 14.6): tools that other programs offer through MCP. A program on this PC runs in the locked box by default; a web address is a
 * server somebody else runs. This page can only ASK main: to add one (main opens the file dialog for a program), to list its tools, to switch a tool on or off, to give
 * a grant, to remove one. Every change that lets the app do more is asked about in a Windows message box, which this page cannot answer; every call the model makes is
 * asked about there too.
 */
function ConnectorsSection({ busy, working }: ConnectorsSectionProps): React.JSX.Element {
  const [status, setStatus] = useState<ConnectorsStatus | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [mine, setMine] = useState(false)
  const [kind, setKind] = useState<'local' | 'remote'>('local')
  const [name, setName] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')

  const reload = useCallback((): void => {
    if (!window.api) return // the preload did not load: the app says so elsewhere
    window.api.connectors.status().then(
      (answer) => {
        setStatus(answer)
        setReadError(null)
      },
      () => setReadError(`The connectors could not be read: ${NO_ANSWER}.`)
    )
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  async function run(
    send: () => Promise<ConnectorChangeResult>,
    asks: boolean,
    done?: string
  ): Promise<boolean> {
    working(true)
    setMine(true)
    setNotice(asks ? { kind: 'ok', text: ASKING } : { kind: 'ok', text: 'Working...' })
    let result: ConnectorChangeResult
    try {
      result = await send()
    } catch {
      result = { ok: false, error: `The connector could not be changed: ${NO_ANSWER}.` }
    }
    working(false)
    setMine(false)
    if (result.ok) {
      setStatus(result.status)
      setNotice(done === undefined ? null : { kind: 'ok', text: done })
    } else {
      if (result.status !== undefined) setStatus(result.status)
      setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })
      reload()
    }
    return result.ok
  }

  async function add(): Promise<void> {
    const added =
      kind === 'local'
        ? await run(() => window.api.connectors.addLocal(name.trim(), argsOf(args)), true, 'The connector was added. Check its tools, then switch on the ones you want.')
        : await run(() => window.api.connectors.addRemote(name.trim(), url.trim(), token), true, 'The connector was added. Check its tools, then switch on the ones you want.')
    if (added) {
      setName('')
      setArgs('')
      setUrl('')
    }
    setToken('') // never kept on the page
  }

  const disabled = busy || mine
  const full = status !== null && status.connectors.length >= CONNECTOR_LIMITS.connectors

  return (
    <section className="tools-section" aria-labelledby="tools-connectors-title">
      <h3 id="tools-connectors-title" className="tools-section-title">
        Connectors
      </h3>
      <p className="tools-hint">
        Tools that other programs offer (MCP). A connector is somebody else&rsquo;s code and words:
        a program on this PC runs in the locked box (a copy of its own folder, a data folder of its
        own, no network unless you allow it); a web address is a server somebody else runs, and what
        is sent to it leaves this PC. Every tool starts off; you read it before you switch it on, and
        every call asks you first in a Windows message box.
        {status !== null &&
          ` ${status.toolsOn} of ${CONNECTOR_LIMITS.toolsOn} connector tools are on.`}
      </p>

      {notice !== null && (
        <p
          className={`tools-notice${notice.kind === 'error' ? ' tools-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
      {readError !== null && (
        <p className="tools-notice tools-notice-error" role="alert">
          {readError}
        </p>
      )}
      {status === null && readError === null && <p className="tools-none">Reading the connectors...</p>}
      {status !== null && status.problem !== null && (
        <div className="tools-problem" role="alert">
          <p>Your connectors could not be read ({status.problem}). Every connector tool is off.</p>
        </div>
      )}

      {status !== null && status.connectors.length > 0 && (
        <ul className="connector-list" aria-label="Connectors">
          {status.connectors.map((c) => (
            <ConnectorCard key={c.id} connector={c} disabled={disabled} run={run} />
          ))}
        </ul>
      )}
      {status !== null && status.connectors.length === 0 && status.problem === null && (
        <p className="tools-none">No connectors yet.</p>
      )}

      {status !== null && status.problem === null && (
        <div className="connector-form" role="group" aria-label="Add a connector">
          <div className="history-actions" role="radiogroup" aria-label="What kind of connector">
            <label>
              <input
                type="radio"
                name="connector-kind"
                checked={kind === 'local'}
                disabled={disabled}
                onChange={() => setKind('local')}
              />{' '}
              A program on this PC
            </label>
            <label>
              <input
                type="radio"
                name="connector-kind"
                checked={kind === 'remote'}
                disabled={disabled}
                onChange={() => setKind('remote')}
              />{' '}
              A web address
            </label>
          </div>
          <input
            className="settings-input"
            aria-label="Name of the connector"
            placeholder="Name (for example: notes)"
            maxLength={CONNECTOR_LIMITS.nameChars}
            value={name}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
          {kind === 'local' ? (
            <>
              <textarea
                className="settings-input"
                aria-label="Arguments, one per line"
                placeholder="Arguments, one per line (may be empty)"
                rows={3}
                value={args}
                disabled={disabled}
                onChange={(event) => setArgs(event.target.value)}
              />
              <p className="tools-hint">
                The next step opens a Windows file dialog: choose a script for node (.js, .mjs,
                .cjs) or a program (.exe). The app installs nothing and never uses a shell.
                {status.nodeInstalled ? '' : ' Node.js is not installed, so only an .exe can be added.'}
              </p>
            </>
          ) : (
            <>
              <input
                className="settings-input"
                aria-label="Web address"
                placeholder="https://..."
                maxLength={CONNECTOR_LIMITS.urlChars}
                value={url}
                disabled={disabled}
                onChange={(event) => setUrl(event.target.value)}
              />
              <input
                className="settings-input"
                type="password"
                autoComplete="off"
                aria-label="Token (optional)"
                placeholder="Token (optional): kept in the system's secure storage"
                maxLength={CONNECTOR_LIMITS.tokenChars}
                value={token}
                disabled={disabled}
                onChange={(event) => setToken(event.target.value)}
              />
            </>
          )}
          <div className="history-actions">
            <button
              type="button"
              className="history-button"
              disabled={disabled || full || name.trim() === '' || (kind === 'remote' && url.trim() === '')}
              onClick={() => void add()}
            >
              {kind === 'local' ? 'Choose the program and add...' : 'Add...'}
            </button>
          </div>
          {full && (
            <p className="tools-hint">
              {CONNECTOR_LIMITS.connectors} connectors is the most the app keeps.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

export default ConnectorsSection
