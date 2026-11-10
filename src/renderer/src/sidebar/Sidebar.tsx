import { useState } from 'react'
import { savedPageOrder, savePageOrder, setRail, setTheme, useRail, useTheme } from '../appearance'
import { moveTo, orderOf } from '../../../shared/order'
import { MOVE_HINT, reorderable } from '../reorder'
import type { UseHistory } from '../history/useHistory'
import ChatRow from './ChatRow'
import { groupChats } from './groups'
import {
  IconExperts,
  IconHistory,
  IconLibrary,
  IconProject,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconStudio,
  IconSun,
  IconTools,
  LogoMark
} from '../icons'

/** (23.8, D-055) The pages the sidebar lists, in their first order. */
const PAGE_IDS = ['studio', 'experts', 'projects', 'library', 'history', 'tools'] as const
type PageId = (typeof PAGE_IDS)[number]

interface SidebarProps {
  /** A reply is arriving: no other chat can be started or opened meanwhile, and the pages that could change it wait. */
  isReplying: boolean
  /** How many messages the chat on screen has; a new chat can only be started from one that has some. */
  messageCount: number
  /** The saved chats (D-016, D-017): the newest are listed here, and one is opened with a click. */
  history: UseHistory
  onNewChat: () => void
  onOpenHistory: () => void
  onOpenTools: () => void
  onOpenSettings: () => void
  /** (21.5, D-053) Opens Search chats. */
  onSearch: () => void
  /** (22.1, 22.2, D-054) The pages AI Fiesta lists under New chat: Experts, Projects, Library. */
  /** (22.3) Image Studio, the first page, as AI Fiesta's. */
  onOpenStudio: () => void
  onOpenExperts: () => void
  onOpenProjects: () => void
  onOpenLibrary: () => void
  /** (24.4, D-056) The page that fills the chat area now, marked in the list; null while the chat is on show. */
  page: PageId | null
}

/**
 * The column at the left of the window (D-051): New chat, History, Tools, the saved chats newest first, Settings and the theme.
 * It folds to a rail of icons (the person's choice, kept on this computer) and is always a rail in a narrow window. The buttons keep
 * the rules they had under the message box and in the header (D-029): what waits for a reply says so in its tooltip.
 */
function Sidebar({
  isReplying,
  messageCount,
  history,
  onNewChat,
  onOpenHistory,
  onOpenTools,
  onOpenSettings,
  onSearch,
  onOpenStudio,
  onOpenExperts,
  onOpenProjects,
  onOpenLibrary,
  page: current
}: SidebarProps): React.JSX.Element {
  const rail = useRail()
  const theme = useTheme()
  // True while a chat picked from the list is being opened: the others wait, so two requests cannot cross.
  const [opening, setOpening] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const saveFailed = history.saveError !== null

  async function openChat(id: string): Promise<void> {
    if (opening) return
    setOpening(true)
    setProblem(null)
    const error = await history.open(id)
    setOpening(false)
    setProblem(error)
  }

  const chats = history.conversations ?? []
  // (23.8, D-055) The pages, each with its words and what it opens ("className": the names the checks know them by), in the order the person chose.
  const pages: Record<
    PageId,
    {
      label: string
      className: string
      icon: React.JSX.Element
      wait: string
      hint: string
      open: () => void
    }
  > = {
    studio: {
      label: 'Image Studio',
      className: 'sidebar-studio',
      icon: <IconStudio />,
      wait: 'Image Studio can be opened when the reply has finished.',
      hint: 'Make pictures from a description, in a style you pick.',
      open: onOpenStudio
    },
    experts: {
      label: 'Experts',
      className: 'sidebar-experts',
      icon: <IconExperts />,
      wait: 'Experts can be opened when the reply has finished.',
      hint: 'Start a chat with a ready-made assistant, or make your own.',
      open: onOpenExperts
    },
    projects: {
      label: 'Projects',
      className: 'sidebar-projects',
      icon: <IconProject />,
      wait: 'Projects can be opened when the reply has finished.',
      hint: 'Group chats with their own instructions and files.',
      open: onOpenProjects
    },
    library: {
      label: 'Library',
      className: 'sidebar-library',
      icon: <IconLibrary />,
      wait: 'The Library can be opened when the reply has finished.',
      hint: 'Every file you attached and every picture made, in one place.',
      open: onOpenLibrary
    },
    history: {
      label: 'History',
      className: '',
      icon: <IconHistory />,
      wait: 'History can be opened when the reply has finished.',
      hint: 'Open a saved chat, or delete one.',
      open: onOpenHistory
    },
    // The tools the model may ask for, and the audit log of what it asked (D-041).
    tools: {
      label: 'Tools',
      className: 'chat-tools',
      icon: <IconTools />,
      wait: 'Tools can be opened when the reply has finished.',
      hint: 'See what the model has asked tools to do, and what you answered.',
      open: onOpenTools
    }
  }
  const [order, setOrder] = useState<PageId[]>(
    () => orderOf(savedPageOrder(), PAGE_IDS) as PageId[]
  )
  const movePage = (id: string, to: number): void => {
    const next = moveTo(
      order.map((page) => ({ id: page })),
      id,
      to
    )?.map((page) => page.id as PageId)
    if (next === undefined) return
    setOrder(next)
    savePageOrder(next)
  }
  const other = theme === 'dark' ? 'light' : 'dark'

  return (
    <aside className="sidebar" id="sidebar" aria-label="Chats and pages">
      <div className="sidebar-head">
        <span className="sidebar-logo">
          <LogoMark />
        </span>
        <h1 className="app-title">Frontier App</h1>
        {/* (21.5, D-053) Search chats, beside the fold button, as AI Fiesta's. */}
        <button
          type="button"
          className="icon-button sidebar-search"
          disabled={isReplying}
          title={
            isReplying
              ? 'Chats can be searched when the reply has finished.'
              : 'Search chats (Ctrl+K)'
          }
          onClick={onSearch}
        >
          <IconSearch />
          <span className="visually-hidden">Search chats</span>
        </button>
        <button
          type="button"
          className="icon-button sidebar-toggle"
          aria-controls="sidebar"
          aria-expanded={!rail}
          title={rail ? 'Show the sidebar' : 'Fold the sidebar to icons'}
          onClick={() => setRail(!rail)}
        >
          <IconSidebar />
          <span className="visually-hidden">{rail ? 'Show the sidebar' : 'Fold the sidebar'}</span>
        </button>
      </div>

      <button
        type="button"
        className="chat-button sidebar-new"
        disabled={isReplying || messageCount === 0}
        title={
          isReplying
            ? 'A new chat can be started when the reply has finished.'
            : messageCount === 0
              ? 'This chat is empty.'
              : saveFailed
                ? 'Start a new chat. This one is not saved, so it would be lost.'
                : 'Start a new chat. This one stays saved in History.'
        }
        onClick={onNewChat}
      >
        <IconPlus />
        <span className="sidebar-label">New chat</span>
      </button>

      <nav className="sidebar-nav" aria-label="Pages">
        {/* (22.1-22.3, D-054) As AI Fiesta's sidebar: the pages first, then History and Tools. (23.8, D-055) In the person's own order. */}
        {order.map((id, index) => {
          const page = pages[id]
          return (
            <button
              key={id}
              type="button"
              className={`chat-button sidebar-item${page.className === '' ? '' : ` ${page.className}`}`}
              disabled={isReplying}
              title={isReplying ? page.wait : `${page.hint} ${MOVE_HINT}`}
              aria-current={id === current ? 'page' : undefined}
              onClick={page.open}
              {...reorderable('pages', id, index, order.length, movePage)}
            >
              {page.icon}
              <span className="sidebar-label">{page.label}</span>
            </button>
          )
        })}
      </nav>

      <section className="sidebar-recent" aria-labelledby="sidebar-recent-heading">
        {/* Named for screen readers only: the groups under it carry visible headings (Pinned, Today, ...). */}
        <h2 id="sidebar-recent-heading" className="sidebar-heading visually-hidden">
          Recent
        </h2>
        {history.conversations !== null && chats.length === 0 && (
          <p className="sidebar-none">Your chats appear here once you send a message.</p>
        )}
        {/* (23.1, D-055) In groups: Pinned, Today, Yesterday, Previous 7 and 30 days, then by month; each chat with its "..." menu. */}
        <div className="sidebar-chats">
          {groupChats(chats).map((group) => (
            <section key={group.label} className="sidebar-group" aria-label={group.label}>
              <h3 className="sidebar-group-heading">{group.label}</h3>
              <ul className="sidebar-group-list">
                {group.chats.map((conversation) => (
                  <ChatRow
                    key={conversation.id}
                    conversation={conversation}
                    current={conversation.id === history.activeId}
                    disabled={isReplying || opening}
                    tooltip={
                      isReplying
                        ? 'Another chat can be opened when the reply has finished.'
                        : saveFailed && conversation.id !== history.activeId
                          ? `${conversation.title}. The chat on screen is not saved: opening another one would lose it.`
                          : conversation.title
                    }
                    onOpen={() => void openChat(conversation.id)}
                    onRename={(title) => history.rename(conversation.id, title)}
                    onPin={(on) => history.pin(conversation.id, on)}
                    onDelete={() => history.remove(conversation.id)}
                    onProblem={setProblem}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
        {problem !== null && (
          <p className="sidebar-problem" role="alert">
            {problem}
          </p>
        )}
      </section>

      <div className="sidebar-foot">
        {/* "header-button": the name the checks know Settings by, from the time it sat in the header (before D-051). */}
        <button
          type="button"
          className="header-button sidebar-item"
          title="Settings"
          onClick={onOpenSettings}
        >
          <IconSettings />
          <span className="sidebar-label">Settings</span>
        </button>
        <button
          type="button"
          className="icon-button theme-button"
          title={`Switch to the ${other} theme`}
          onClick={() => setTheme(other)}
        >
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
          <span className="visually-hidden">{`Switch to the ${other} theme`}</span>
        </button>
      </div>
    </aside>
  )
}

export default Sidebar
