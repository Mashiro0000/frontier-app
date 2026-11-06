import { useState } from 'react'
import { setRail, setTheme, useRail, useTheme } from '../appearance'
import type { UseHistory } from '../history/useHistory'
import {
  IconHistory,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSun,
  IconTools,
  LogoMark
} from '../icons'

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
  onSearch
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
        <button
          type="button"
          className="chat-button sidebar-item"
          disabled={isReplying}
          title={
            isReplying
              ? 'History can be opened when the reply has finished.'
              : 'Open a saved chat, or delete one.'
          }
          onClick={onOpenHistory}
        >
          <IconHistory />
          <span className="sidebar-label">History</span>
        </button>
        {/* The tools the model may ask for, and the audit log of what it asked (D-041). */}
        <button
          type="button"
          className="chat-button sidebar-item chat-tools"
          disabled={isReplying}
          title={
            isReplying
              ? 'Tools can be opened when the reply has finished.'
              : 'See what the model has asked tools to do, and what you answered.'
          }
          onClick={onOpenTools}
        >
          <IconTools />
          <span className="sidebar-label">Tools</span>
        </button>
      </nav>

      <section className="sidebar-recent" aria-labelledby="sidebar-recent-heading">
        <h2 id="sidebar-recent-heading" className="sidebar-heading">
          Recent
        </h2>
        {history.conversations !== null && chats.length === 0 && (
          <p className="sidebar-none">Your chats appear here once you send a message.</p>
        )}
        <ul className="sidebar-chats">
          {chats.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                className="sidebar-chat"
                aria-current={conversation.id === history.activeId ? 'true' : undefined}
                disabled={isReplying || opening}
                title={
                  isReplying
                    ? 'Another chat can be opened when the reply has finished.'
                    : saveFailed && conversation.id !== history.activeId
                      ? `${conversation.title}. The chat on screen is not saved: opening another one would lose it.`
                      : conversation.title
                }
                onClick={() => void openChat(conversation.id)}
              >
                {conversation.title}
              </button>
            </li>
          ))}
        </ul>
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
