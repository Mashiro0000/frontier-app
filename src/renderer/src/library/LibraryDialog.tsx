import { useEffect, useMemo, useRef, useState } from 'react'
import { ATTACHMENT_LIMITS } from '../../../shared/attachments'
import type { PictureSummary } from '../../../shared/images'
import { matchesQuery, type LibraryFile } from '../../../shared/library'

interface LibraryDialogProps {
  open: boolean
  onClose: () => void
  /** Opens a saved chat (as the sidebar's list does): null when it opened, else why not. */
  onOpenChat: (id: string) => Promise<string | null>
}

type Tab = 'all' | 'starred' | 'images' | 'files'
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'starred', label: 'Starred' },
  { id: 'images', label: 'Images' },
  { id: 'files', label: 'Files' }
]

type Item =
  | { kind: 'picture'; id: string; title: string; at: number; picture: PictureSummary }
  | { kind: 'file'; id: string; title: string; at: number; file: LibraryFile }

const size = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`

const day = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * (22.1, D-054) The Library, as AI Fiesta's: every picture the app made and every file attached in the saved chats, newest first, with All / Starred / Images /
 * Files, a search and a star. A picture opens large; a file shows the chats that carry it, each one click away. The files are main's to list (from the chats it
 * can read); the pictures are the gallery's.
 */
function LibraryDialog({ open, onClose, onOpenChat }: LibraryDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [pictures, setPictures] = useState<PictureSummary[]>([])
  const [files, setFiles] = useState<LibraryFile[]>([])
  const [starred, setStarred] = useState<string[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<string[]>([])
  // Each opening is a fresh mount (the app gives it a new key), so it starts loading.
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<Item | null>(null)
  const [large, setLarge] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // The page opens with the search ready, as the model chooser does (not on the close button).
      dialog.querySelector<HTMLInputElement>('.library-search')?.focus()
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  // Each opening reads both lists again (a chat or a picture may have come or gone since).
  useEffect(() => {
    if (!open) return
    let live = true
    void Promise.all([window.api.images.list(), window.api.library.files()])
      .then(([gallery, library]) => {
        if (!live) return
        const said: string[] = []
        setPictures(gallery.pictures)
        if (gallery.problem !== null) said.push(gallery.problem)
        if (library.ok) {
          setFiles(library.files)
          setStarred(library.starred)
          if (library.unreadable > 0) {
            said.push(
              `${library.unreadable} saved ${library.unreadable === 1 ? 'chat' : 'chats'} could not be read; ${library.unreadable === 1 ? 'its' : 'their'} files are not listed.`
            )
          }
          if (library.starsProblem !== null)
            said.push(`Your stars could not be read (${library.starsProblem}).`)
          // The small pictures of attached images, as many as main describes at once.
          const images = library.files
            .filter((f) => f.info.kind === 'image')
            .slice(0, ATTACHMENT_LIMITS.perChat)
          if (images.length > 0) {
            void window.api.attachments
              .describe(images.map((f) => f.info.id))
              .then((previews) => {
                if (!live) return
                const next: Record<string, string> = {}
                for (const p of previews)
                  if ('thumbnail' in p && p.thumbnail !== null) next[p.id] = p.thumbnail
                setThumbs(next)
              })
              .catch(() => undefined)
          }
        } else said.push(library.error)
        setNotes(said)
      })
      .catch(() => {
        if (live) setNotes(['The Library could not be read: the app did not answer.'])
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...pictures.map((p): Item => ({
        kind: 'picture',
        id: p.id,
        title: p.prompt,
        at: p.at,
        picture: p
      })),
      ...files.map((f): Item => ({
        kind: 'file',
        id: f.info.id,
        title: f.info.name,
        at: f.lastUsed,
        file: f
      }))
    ]
    return all.sort((a, b) => b.at - a.at)
  }, [pictures, files])

  const shown = items.filter(
    (item) =>
      (tab === 'all' ||
        (tab === 'starred' && starred.includes(item.id)) ||
        (tab === 'images' && (item.kind === 'picture' || item.file.info.kind === 'image')) ||
        (tab === 'files' && item.kind === 'file' && item.file.info.kind !== 'image')) &&
      matchesQuery(item.title, query)
  )

  async function star(id: string): Promise<void> {
    const on = !starred.includes(id)
    const result = await window.api.library.star(id, on)
    if (result.ok) setStarred(result.starred)
    else setNotes([result.error])
  }

  async function show(item: Item): Promise<void> {
    setPicked(item)
    setLarge(null)
    if (item.kind === 'picture') {
      const result = await window.api.images.picture(item.id)
      if (result.ok) setLarge(result.dataUrl)
      else setNotes([result.error])
    }
  }

  const close = (): void => {
    setPicked(null)
    setLarge(null)
    setQuery('')
    setTab('all')
    onClose()
  }

  return (
    <dialog ref={dialogRef} className="library" aria-labelledby="library-title" onClose={close}>
      <div className="page-head">
        <div>
          <h2 id="library-title" className="page-title">
            Library
          </h2>
          <p className="page-subtitle">
            Every picture you made and every file you attached, in one place.
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
        <div className="model-chooser-filters" role="tablist" aria-label="Show">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="chip"
              aria-selected={tab === t.id}
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          className="model-chooser-search library-search"
          type="search"
          placeholder="Search the Library..."
          aria-label="Search the Library"
          maxLength={200}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {notes.length > 0 && (
        <div className="library-notes" role="status">
          {notes.map((n) => (
            <p key={n} className="settings-hint">
              {n}
            </p>
          ))}
        </div>
      )}
      {picked !== null ? (
        <div className="library-detail">
          <button type="button" className="link-button" onClick={() => setPicked(null)}>
            Back to the Library
          </button>
          {picked.kind === 'picture' ? (
            <>
              {large !== null ? (
                <img className="library-large" src={large} alt={picked.title} />
              ) : (
                <p className="settings-hint">Opening the picture...</p>
              )}
              <p className="library-detail-title">{picked.title}</p>
              <p className="settings-hint">
                {picked.picture.modelLabel} · {picked.picture.width}×{picked.picture.height} ·{' '}
                {day(picked.at)}
              </p>
            </>
          ) : (
            <>
              <p className="library-detail-title">{picked.title}</p>
              <p className="settings-hint">
                {picked.file.info.kind === 'pdf'
                  ? 'PDF'
                  : picked.file.info.kind === 'image'
                    ? 'Image'
                    : 'Text'}{' '}
                · {size(picked.file.info.bytes)} · last used {day(picked.at)}
              </p>
              <h3 className="library-chats-heading">
                In {picked.file.chats.length} {picked.file.chats.length === 1 ? 'chat' : 'chats'}
              </h3>
              <ul className="library-chats">
                {picked.file.chats.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="search-hit"
                      onClick={() =>
                        void onOpenChat(c.id).then((error) =>
                          error === null ? close() : setNotes([error])
                        )
                      }
                    >
                      <span className="search-hit-title">{c.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : shown.length === 0 ? (
        <p className="settings-hint library-empty">
          {loading
            ? 'Reading the Library...'
            : items.length === 0
              ? 'Nothing here yet. Files you attach and pictures you make appear here.'
              : tab === 'starred' && query === ''
                ? 'Nothing starred yet: star something with the ☆ on its card.'
                : 'Nothing matches.'}
        </p>
      ) : (
        <ul className="library-grid" aria-label="Library">
          {shown.map((item) => {
            const thumb =
              item.kind === 'picture' ? item.picture.thumbnail : (thumbs[item.id] ?? null)
            const isStarred = starred.includes(item.id)
            return (
              <li
                key={`${item.kind}-${item.id}`}
                className="library-card"
                data-kind={item.kind}
                data-id={item.id}
              >
                <button type="button" className="library-open" onClick={() => void show(item)}>
                  <span className="library-thumb">
                    {thumb !== null ? (
                      <img src={thumb} alt="" />
                    ) : (
                      <span className="library-kind">
                        {item.kind === 'file'
                          ? item.file.info.kind === 'pdf'
                            ? 'PDF'
                            : item.file.info.kind === 'image'
                              ? 'IMG'
                              : 'TXT'
                          : 'IMG'}
                      </span>
                    )}
                  </span>
                  <span className="library-name">{item.title}</span>
                  <span className="library-meta">
                    {item.kind === 'picture'
                      ? `Made · ${day(item.at)}`
                      : `${size(item.file.info.bytes)} · ${item.file.chats.length} ${item.file.chats.length === 1 ? 'chat' : 'chats'}`}
                  </span>
                </button>
                <button
                  type="button"
                  className={`library-star${isStarred ? ' library-star-on' : ''}`}
                  aria-pressed={isStarred}
                  aria-label={isStarred ? 'Unstar' : 'Star'}
                  title={isStarred ? 'Unstar' : 'Star'}
                  onClick={() => void star(item.id)}
                >
                  {isStarred ? '★' : '☆'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </dialog>
  )
}

export default LibraryDialog
