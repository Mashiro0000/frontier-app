import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { reorderable } from '../reorder'
import type { AttachmentInfo } from '../../../shared/attachments'
import { CHAT_LIMITS, type SecretFinding } from '../../../shared/ipc'
import {
  checkProjectName,
  PROJECT_LIMITS,
  type Project,
  type ProjectChangeResult
} from '../../../shared/projects'
import { checkInstructions } from '../../../shared/validate'
import type { ProjectsState } from './useProjects'

const fmt = (n: number): string => n.toLocaleString('en-US')
const NO_ANSWER = 'the app did not answer'
const WAITING = 'Waiting for your answer in the Windows message box...'
const MAX_INSTRUCTIONS = CHAT_LIMITS.maxInstructionsChars

type Notice = { kind: 'ok' | 'error'; text: string }
/** What the open project's box is for, if anything. */
type Editing = 'rename' | 'instructions' | null

/** What a file is, in a few words: "12 pages, 1.2 MB". */
function fileFacts(file: AttachmentInfo): string {
  const size =
    file.bytes >= 1024 * 1024
      ? `${(file.bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.round(file.bytes / 1024))} KB`
  if (file.kind === 'pdf' && file.pages !== undefined) {
    return `${fmt(file.pages)} ${file.pages === 1 ? 'page' : 'pages'}, ${size}`
  }
  if (file.kind === 'text' && file.chars !== undefined) return `${fmt(file.chars)} characters`
  return size
}

/** One line about a project in the list: its files and whether it has instructions. */
function projectFacts(project: Project): string {
  const files =
    project.files.length === 0
      ? 'no files'
      : `${project.files.length} ${project.files.length === 1 ? 'file' : 'files'}`
  return `${files} · ${project.instructions === '' ? 'no instructions' : 'instructions'}`
}

interface ProjectsDialogProps {
  open: boolean
  projects: ProjectsState
  /** The project of the chat on screen, or null. */
  chatProject: string | null
  /** Moves the chat on screen into a project, or out of every project (null). */
  onChatProject: (id: string | null) => void
  /** Starts a new chat in a project. */
  onNewChatIn: (id: string) => void
  onClose: () => void
}

/**
 * The Projects page (D-039): which project the chat on screen belongs to, and every project with its name, instructions and files. New or changed
 * instructions and added files are kept only after the person's yes in the system's own message box, which this page cannot answer; making, renaming,
 * taking a file off and deleting (which asks here first) send nothing new. A project's name is the person's label and never goes to the model.
 */
function ProjectsDialog({
  open,
  projects,
  chatProject,
  onChatProject,
  onNewChatIn,
  onClose
}: ProjectsDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const busyRef = useRef(false)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const close = (): void => dialogRef.current?.close()

  return (
    <dialog
      ref={dialogRef}
      className="projects"
      aria-labelledby="projects-title"
      onCancel={(event) => {
        if (busyRef.current) event.preventDefault()
      }}
      onClose={() => {
        busyRef.current = false
        onClose()
      }}
    >
      <h2 id="projects-title" className="projects-heading">
        Projects
      </h2>
      {open && (
        <ProjectsBody
          projects={projects}
          chatProject={chatProject}
          onChatProject={onChatProject}
          onNewChatIn={(id) => {
            onNewChatIn(id)
            close()
          }}
          onBusy={(on) => {
            busyRef.current = on
          }}
          onClose={close}
        />
      )}
    </dialog>
  )
}

interface ProjectsBodyProps {
  projects: ProjectsState
  chatProject: string | null
  onChatProject: (id: string | null) => void
  onNewChatIn: (id: string) => void
  onBusy: (busy: boolean) => void
  onClose: () => void
}

function ProjectsBody({
  projects,
  chatProject,
  onChatProject,
  onNewChatIn,
  onBusy,
  onClose
}: ProjectsBodyProps): React.JSX.Element {
  const { status } = projects
  const [selected, setSelected] = useState<string | null>(chatProject)
  const [editing, setEditing] = useState<Editing>(null)
  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)
  const [warnings, setWarnings] = useState<SecretFinding[] | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [refused, setRefused] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // 'delete' (the open project) or 'all' (the way out of a damaged file), waiting for a yes on this page.
  const [asking, setAsking] = useState<'delete' | 'all' | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const input = inputRef.current
    if (!input || (editing === null && !creating)) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [editing, creating])

  function working(on: boolean): void {
    setBusy(on)
    onBusy(on)
  }

  async function change(
    run: () => Promise<ProjectChangeResult>,
    asks: boolean,
    done?: (result: Extract<ProjectChangeResult, { ok: true }>) => void
  ): Promise<void> {
    working(true)
    setNotice(asks ? { kind: 'ok', text: WAITING } : null)
    setRefused([])
    let result: ProjectChangeResult
    try {
      result = await run()
    } catch {
      result = { ok: false, error: `Your projects could not be changed: ${NO_ANSWER}.` }
    }
    if (result.ok) projects.setStatus(result.status)
    if (!mounted.current) return
    working(false)
    setAsking(null)
    setRefused(result.refused ?? [])
    if (result.ok) {
      setNotice(null)
      setWarnings(null)
      done?.(result)
      return
    }
    setWarnings(result.warnings ?? null)
    setNotice({ kind: result.cancelled ? 'ok' : 'error', text: result.error })
  }

  function startEditing(next: Editing, project: Project | null): void {
    setEditing(next)
    setCreating(false)
    setText(
      next === 'rename'
        ? (project?.name ?? '')
        : next === 'instructions'
          ? (project?.instructions ?? '')
          : ''
    )
    setWarnings(null)
    setNotice(null)
    setAsking(null)
  }

  function stopEditing(): void {
    setEditing(null)
    setCreating(false)
    setText('')
    setWarnings(null)
  }

  if (status === null) {
    return (
      <div className="projects-body">
        <p className="projects-status">Your projects could not be read just now.</p>
        <div className="projects-footer">
          <button type="button" className="button button-secondary" onClick={projects.reload}>
            Try again
          </button>
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    )
  }

  const project = status.projects.find((p) => p.id === selected) ?? null
  const chatsProject = status.projects.find((p) => p.id === chatProject) ?? null

  // The box: a name (new project, rename) or the instructions.
  const nameCheck = checkProjectName(text)
  const instructionsCheck = checkInstructions(text)
  const instructionsText = instructionsCheck.ok ? instructionsCheck.instructions : text.trim()
  const tooMany = instructionsText.length - MAX_INSTRUCTIONS
  const canSaveName = nameCheck.ok && !busy && (creating || nameCheck.name !== project?.name)
  const turningOff =
    editing === 'instructions' && instructionsText === '' && (project?.instructions ?? '') !== ''
  const canSaveInstructions =
    instructionsCheck.ok &&
    !busy &&
    instructionsCheck.instructions !== (project?.instructions ?? '')

  function saveName(): void {
    if (!canSaveName || !nameCheck.ok) return
    const name = nameCheck.name
    if (creating) {
      void change(
        () => window.api.projects.create(name),
        false,
        (result) => {
          stopEditing()
          if (result.project !== undefined) setSelected(result.project)
        }
      )
    } else if (project !== null) {
      void change(() => window.api.projects.rename(project.id, name), false, stopEditing)
    }
  }

  function saveInstructions(): void {
    if (!canSaveInstructions || !instructionsCheck.ok || project === null) return
    const next = instructionsCheck.instructions
    const anyway = warnings !== null
    void change(
      () => window.api.projects.setInstructions(project.id, next, anyway),
      next !== '',
      stopEditing
    )
  }

  const nameBox = (
    <form
      className="projects-editor"
      onSubmit={(event) => {
        event.preventDefault()
        saveName()
      }}
    >
      <label className="projects-label" htmlFor="projects-name">
        {creating ? 'Name of the new project' : 'New name'}
      </label>
      <input
        id="projects-name"
        ref={(element) => {
          inputRef.current = element
        }}
        className="projects-name-input"
        type="text"
        value={text}
        readOnly={busy}
        maxLength={PROJECT_LIMITS.maxNameChars * 2}
        placeholder="For example: Thesis"
        onChange={(event) => {
          setText(event.target.value)
          setNotice(null)
        }}
      />
      <p className="projects-hint">The name is only for you: it is never sent to the model.</p>
      <div className="projects-editor-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={stopEditing}
        >
          Cancel
        </button>
        <button type="submit" className="button" disabled={!canSaveName}>
          {creating ? 'Create' : 'Rename'}
        </button>
      </div>
    </form>
  )

  const instructionsBox = (
    <form
      className="projects-editor"
      onSubmit={(event) => {
        event.preventDefault()
        saveInstructions()
      }}
    >
      <label className="projects-label" htmlFor="projects-instructions">
        Instructions for this project
      </label>
      <textarea
        id="projects-instructions"
        ref={(element) => {
          inputRef.current = element
        }}
        className="projects-input"
        rows={6}
        value={text}
        readOnly={busy}
        placeholder="For example: This project is my thesis on sleep and shift work. Cite sources, and use British spelling."
        onChange={(event) => {
          setText(event.target.value)
          setWarnings(null)
          setNotice(null)
        }}
      />
      {tooMany > 0 ? (
        <p className="projects-count projects-count-over" role="alert">
          {fmt(instructionsText.length)} of {fmt(MAX_INSTRUCTIONS)} characters: {fmt(tooMany)} too
          many to save. They are sent with every message, so they are kept short.
        </p>
      ) : (
        <p className="projects-count">
          {fmt(instructionsText.length)} of {fmt(MAX_INSTRUCTIONS)} characters
        </p>
      )}
      {warnings !== null && warnings.length > 0 && (
        <ul className="projects-secrets" aria-label="Parts that look like a secret">
          {warnings.map((finding, index) => (
            <li key={index}>
              {finding.shown} looks like {finding.what}.
            </li>
          ))}
        </ul>
      )}
      <p className="projects-hint">
        They go to the company that runs the model with every message of every chat in this project,
        after your instructions for every chat and before a chat&apos;s own. Do not put passwords or
        keys here. Saving new text asks you once more in a window of its own.
      </p>
      <div className="projects-editor-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={busy}
          onClick={stopEditing}
        >
          Cancel
        </button>
        <button type="submit" className="button" disabled={!canSaveInstructions}>
          {warnings !== null ? 'Save anyway' : turningOff ? 'Turn off' : 'Save'}
        </button>
      </div>
    </form>
  )

  return (
    <div className="projects-body">
      <p className="projects-hint">
        A project gives a group of chats the same instructions, files and notes. They go to the
        company that runs the model with every message of each chat in the project, and are kept in
        the app&apos;s data folder on this computer (encrypted when your chats are).
      </p>

      {status.problem !== null ? (
        <div className="projects-problem" role="alert">
          <p>
            Your projects could not be read ({status.problem}). Nothing is sent from a chat in a
            project until you delete them all; the app keeps a copy of the file.
          </p>
          <div className="projects-actions">
            <button
              type="button"
              className="history-button"
              disabled={busy}
              onClick={() => setAsking('all')}
            >
              Delete all projects...
            </button>
          </div>
        </div>
      ) : (
        <label className="projects-chat">
          This chat belongs to{' '}
          <select
            className="projects-chat-select"
            value={chatsProject?.id ?? ''}
            disabled={busy}
            onChange={(event) =>
              onChatProject(event.target.value === '' ? null : event.target.value)
            }
          >
            <option value="">no project</option>
            {status.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {notice !== null && (
        <p
          className={`projects-notice${notice.kind === 'error' ? ' projects-notice-error' : ''}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      )}
      {refused.length > 0 && (
        <ul className="projects-refused" aria-label="Files not added">
          {refused.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}

      {status.problem === null && (
        <section className="projects-list-section" aria-label="Your projects">
          <div className="projects-list-head">
            <h3 className="projects-list-title">Your projects</h3>
            <span className="projects-list-use">
              {status.projects.length} of {PROJECT_LIMITS.maxProjects}
            </span>
          </div>
          {status.projects.length === 0 && !creating ? (
            <p className="projects-none">No projects yet.</p>
          ) : (
            <ul className="projects-list">
              {/* eslint-disable-next-line react-hooks/refs -- the move runs on a drop or a key press, never while the list is drawn */}
              {status.projects.map((p, at) => (
                <li
                  key={p.id}
                  className="projects-row"
                  // (23.8, D-055) in the person's order: drag a row, or Alt+Up / Alt+Down on it
                  {...(busy || editing !== null || creating
                    ? {}
                    : reorderable(
                        'projects',
                        p.id,
                        at,
                        status.projects.length,
                        (id, to) => void change(() => window.api.projects.move(id, to), false)
                      ))}
                >
                  <button
                    type="button"
                    className="projects-open"
                    aria-current={p.id === selected ? 'true' : undefined}
                    disabled={busy || editing !== null || creating}
                    onClick={() => {
                      setSelected(p.id === selected ? null : p.id)
                      setAsking(null)
                      setNotice(null)
                      setRefused([])
                    }}
                  >
                    <span className="projects-name">{p.name}</span>
                    <span className="projects-facts">
                      {projectFacts(p)}
                      {p.id === chatProject ? ' · this chat' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {creating ? (
            nameBox
          ) : (
            <div className="projects-actions">
              <button
                type="button"
                className="history-button"
                disabled={
                  busy || editing !== null || status.projects.length >= PROJECT_LIMITS.maxProjects
                }
                onClick={() => {
                  startEditing(null, null)
                  setCreating(true)
                }}
              >
                New project...
              </button>
            </div>
          )}
        </section>
      )}

      {status.problem === null && project !== null && (
        <section className="projects-detail" aria-label={`The project ${project.name}`}>
          <div className="projects-detail-head">
            <h3 className="projects-detail-title">{project.name}</h3>
            <span className="projects-actions">
              <button
                type="button"
                className="history-button"
                disabled={busy || editing !== null || creating}
                onClick={() => startEditing('rename', project)}
              >
                Rename...
              </button>
              <button
                type="button"
                className="history-button"
                disabled={busy || editing !== null || creating}
                onClick={() => onNewChatIn(project.id)}
              >
                New chat in this project
              </button>
            </span>
          </div>
          {editing === 'rename' && nameBox}

          <div className="projects-part">
            <div className="projects-part-head">
              <h4 className="projects-part-title">Instructions</h4>
              {editing !== 'instructions' && (
                <button
                  type="button"
                  className="history-button"
                  disabled={busy || editing !== null || creating}
                  onClick={() => startEditing('instructions', project)}
                >
                  Change...
                </button>
              )}
            </div>
            {editing === 'instructions' ? (
              instructionsBox
            ) : project.instructions === '' ? (
              <p className="projects-none">None.</p>
            ) : (
              <p className="projects-text">{project.instructions}</p>
            )}
          </div>

          <div className="projects-part">
            <div className="projects-part-head">
              <h4 className="projects-part-title">
                Files ({project.files.length} of {PROJECT_LIMITS.maxFiles})
              </h4>
              <button
                type="button"
                className="history-button"
                disabled={
                  busy ||
                  editing !== null ||
                  creating ||
                  project.files.length >= PROJECT_LIMITS.maxFiles
                }
                onClick={() => void change(() => window.api.projects.addFiles(project.id), true)}
              >
                Add files...
              </button>
            </div>
            {project.files.length === 0 ? (
              <p className="projects-none">
                None. Files you add go with every message of the project&apos;s chats.
              </p>
            ) : (
              <ul className="projects-files">
                {project.files.map((file) => (
                  <li key={file.id} className="projects-file">
                    <span className="projects-file-name">{file.name}</span>
                    <span className="projects-file-facts">{fileFacts(file)}</span>
                    <button
                      type="button"
                      className="history-button"
                      aria-label={`Take ${file.name} off the project`}
                      disabled={busy || editing !== null || creating}
                      onClick={() =>
                        void change(
                          () => window.api.projects.removeFile(project.id, file.id),
                          false
                        )
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {asking === 'delete' ? (
            <div className="projects-ask" role="group" aria-label="Delete this project?">
              <span className="projects-ask-text">
                Delete the project &quot;{project.name}&quot;? Its chats stay, in no project; its
                notes are deleted, and its files unless a chat uses them.
              </span>
              <button
                type="button"
                className="history-button history-button-danger"
                disabled={busy}
                onClick={() =>
                  void change(
                    () => window.api.projects.remove(project.id),
                    false,
                    () => setSelected(null)
                  )
                }
              >
                Delete
              </button>
              <button
                type="button"
                className="history-button"
                autoFocus
                disabled={busy}
                onClick={() => setAsking(null)}
              >
                Keep
              </button>
            </div>
          ) : (
            <div className="projects-actions">
              <button
                type="button"
                className="history-button"
                disabled={busy || editing !== null || creating}
                onClick={() => setAsking('delete')}
              >
                Delete project...
              </button>
            </div>
          )}
        </section>
      )}

      {asking === 'all' && (
        <div className="projects-ask" role="group" aria-label="Delete all projects?">
          <span className="projects-ask-text">
            Delete every project and start again? The file that could not be read is kept as a copy.
          </span>
          <button
            type="button"
            className="history-button history-button-danger"
            disabled={busy}
            onClick={() => void change(() => window.api.projects.removeAll(), false)}
          >
            Delete all
          </button>
          <button
            type="button"
            className="history-button"
            autoFocus
            disabled={busy}
            onClick={() => setAsking(null)}
          >
            Keep them
          </button>
        </div>
      )}

      <div className="projects-footer">
        <button type="button" className="button" disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}

export default ProjectsDialog
