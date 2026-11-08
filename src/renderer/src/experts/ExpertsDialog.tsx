import { useEffect, useRef, useState } from 'react'
import { MOVE_HINT, reorderable } from '../reorder'
import { EXPERT_CATEGORIES, EXPERTS, type Expert } from '../../../shared/experts'
import { MY_EXPERT_LIMITS, type MyExpert } from '../../../shared/myExperts'
import { TASKS, type TaskId } from '../../../shared/rankings'

interface ExpertsDialogProps {
  open: boolean
  onClose: () => void
  /** Starts a new chat with these instructions and this task (the chat's own instructions: the person sees and can change them). */
  onStart: (expert: { name: string; instructions: string; task: TaskId }) => void
  /** A reply is arriving: a new chat cannot be started until it ends. */
  replying: boolean
}

type Tab = 'experts' | 'mine'
const EMPTY_FORM = { name: '', description: '', instructions: '', task: 'chat' as TaskId }

/** The first letters of a name, for the round mark on a card (no pictures of people: a mark of the app's own colours). */
const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? '')
    .join('')

/**
 * (22.2, D-054) Experts, as AI Fiesta's: ready-made assistants in categories and the person's own ("My experts"). "Start a chat" opens a new chat whose own
 * instructions are the expert's (shown on the chat's Instructions button, to change or take off) and sets the task. Nothing is sent until the person writes.
 */
function ExpertsDialog({
  open,
  onClose,
  onStart,
  replying
}: ExpertsDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<Tab>('experts')
  const [category, setCategory] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState<MyExpert[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [form, setForm] = useState<(typeof EMPTY_FORM & { id?: string }) | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // The page opens with the search ready, as the model chooser does (not on the close button).
      dialog.querySelector<HTMLInputElement>('.library-search')?.focus()
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) return
    let live = true
    void window.api.experts
      .list()
      .then((result) => {
        if (!live) return
        if (result.ok) setMine(result.experts)
        else setProblem(result.error)
      })
      .catch(() => {
        if (live) setProblem('Your experts could not be read: the app did not answer.')
      })
    return () => {
      live = false
    }
  }, [open])

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (e: { name: string; description: string }): boolean =>
    words.every((w) => `${e.name} ${e.description}`.toLowerCase().includes(w))
  const ready = EXPERTS.filter((e) => (category === null || e.category === category) && matches(e))
  const own = mine.filter(matches)

  const close = (): void => {
    setForm(null)
    setQuery('')
    setCategory(null)
    setTab('experts')
    setProblem(null)
    onClose()
  }
  const start = (e: Expert | MyExpert): void => {
    onStart({ name: e.name, instructions: e.instructions, task: e.task })
    close()
  }

  async function save(): Promise<void> {
    if (form === null) return
    setBusy(true)
    setProblem(null)
    try {
      const result = await window.api.experts.save(form)
      if (result.ok) {
        setMine(result.experts)
        setForm(null)
      } else setProblem(result.error)
    } catch {
      setProblem('The expert could not be saved: the app did not answer.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    const name = mine.find((e) => e.id === id)?.name ?? 'this expert'
    // Deleting is for good (experts.json keeps no copy), so it is asked first.
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return
    const result = await window.api.experts.remove(id)
    if (result.ok) setMine(result.experts)
    else setProblem(result.error)
  }

  // (23.8, D-055) My experts in the person's order: drag a card, or Alt+Up / Alt+Down on it (not while a search narrows the list).
  async function moveExpert(id: string, to: number): Promise<void> {
    const result = await window.api.experts.move(id, to)
    if (result.ok) setMine(result.experts)
    else setProblem(result.error)
  }
  const card = (
    e: Expert | MyExpert,
    category: string | null,
    editable: boolean,
    at?: number
  ): React.JSX.Element => (
    <li
      key={e.id}
      className="expert-card"
      data-expert={e.id}
      {...(at !== undefined && words.length === 0
        ? {
            ...reorderable('experts', e.id, at, mine.length, (id, to) => void moveExpert(id, to)),
            title: MOVE_HINT
          }
        : {})}
    >
      <span className="expert-mark" aria-hidden="true">
        {initials(e.name)}
      </span>
      <span className="expert-text">
        {category !== null && <span className="model-tag">{category}</span>}
        <span className="expert-name">{e.name}</span>
        {e.description !== '' && <span className="expert-desc">{e.description}</span>}
        <span className="expert-actions">
          <button
            type="button"
            className="button expert-start"
            disabled={replying}
            title={
              replying
                ? 'A new chat can be started when the reply has finished.'
                : `Start a new chat with ${e.name}`
            }
            onClick={() => start(e)}
          >
            Start a chat
          </button>
          {editable && (
            <>
              <button
                type="button"
                className="link-button"
                onClick={() => setForm({ ...(e as MyExpert) })}
              >
                Edit
              </button>
              <button type="button" className="link-button" onClick={() => void remove(e.id)}>
                Delete
              </button>
            </>
          )}
        </span>
      </span>
    </li>
  )

  return (
    <dialog
      ref={dialogRef}
      className="experts"
      aria-labelledby="experts-title"
      onClose={close}
      onClick={(event) => {
        if (event.target === dialogRef.current) close()
      }}
    >
      <div className="page-head">
        <div>
          <h2 id="experts-title" className="page-title">
            Experts
          </h2>
          <p className="page-subtitle">
            Start a chat with an assistant set up for the job. You can see and change its
            instructions.
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          title="Close"
          aria-label="Close"
          onClick={close}
        >
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div className="library-tools">
        <div className="model-chooser-filters" role="tablist" aria-label="Which experts">
          <button
            type="button"
            role="tab"
            className="chip"
            aria-selected={tab === 'experts'}
            aria-pressed={tab === 'experts'}
            onClick={() => setTab('experts')}
          >
            Experts
          </button>
          <button
            type="button"
            role="tab"
            className="chip"
            aria-selected={tab === 'mine'}
            aria-pressed={tab === 'mine'}
            onClick={() => setTab('mine')}
          >
            My experts
          </button>
        </div>
        <input
          className="model-chooser-search library-search"
          type="search"
          placeholder="Search experts..."
          aria-label="Search experts"
          maxLength={200}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {tab === 'experts' && (
        <div
          className="model-chooser-filters experts-categories"
          role="group"
          aria-label="Category"
        >
          <button
            type="button"
            className="chip"
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
          >
            All
          </button>
          {EXPERT_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={category === c}
              onClick={() => setCategory(category === c ? null : c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      {problem !== null && (
        <p className="settings-hint library-notes" role="status">
          {problem}
        </p>
      )}
      {tab === 'experts' ? (
        <ul className="experts-grid" aria-label="Experts">
          {ready.map((e) => card(e, e.category, false))}
        </ul>
      ) : form !== null ? (
        <form
          className="expert-form"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <label className="settings-label" htmlFor="expert-name">
            Name
          </label>
          <input
            id="expert-name"
            className="settings-input"
            maxLength={MY_EXPERT_LIMITS.maxNameChars}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <label className="settings-label" htmlFor="expert-description">
            What it is for (optional)
          </label>
          <input
            id="expert-description"
            className="settings-input"
            maxLength={MY_EXPERT_LIMITS.maxDescriptionChars}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <label className="settings-label" htmlFor="expert-instructions">
            Instructions (they become the chat&apos;s own instructions)
          </label>
          <textarea
            id="expert-instructions"
            className="settings-input expert-instructions"
            rows={6}
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
          <label className="settings-label" htmlFor="expert-task">
            Task
          </label>
          <select
            id="expert-task"
            className="settings-input"
            value={form.task}
            onChange={(e) => setForm({ ...form, task: e.target.value as TaskId })}
          >
            {TASKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="settings-actions">
            <button type="button" className="button button-secondary" onClick={() => setForm(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="button"
              disabled={busy || form.name.trim() === '' || form.instructions.trim() === ''}
            >
              Save expert
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="experts-mine-head">
            <button type="button" className="button" onClick={() => setForm({ ...EMPTY_FORM })}>
              Make an expert
            </button>
          </div>
          {own.length === 0 ? (
            <p className="settings-hint library-empty">
              {mine.length === 0
                ? 'You have no experts of your own yet. Make one: a name and the instructions a chat should start with.'
                : 'Nothing matches.'}
            </p>
          ) : (
            <ul className="experts-grid" aria-label="My experts">
              {own.map((e, at) => card(e, null, true, at))}
            </ul>
          )}
        </>
      )}
    </dialog>
  )
}

export default ExpertsDialog
