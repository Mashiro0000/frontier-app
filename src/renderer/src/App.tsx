import { useState } from 'react'
import ChatView from './chat/ChatView'
import { ipcReply } from './chat/ipcReply'
import { useChat } from './chat/useChat'
import HistoryDialog from './history/HistoryDialog'
import { useHistory } from './history/useHistory'
import { providerMissingKey } from './settings/format'
import ModelPicker from './settings/ModelPicker'
import SettingsDialog from './settings/SettingsDialog'
import { useSettingsStatus } from './settings/useSettingsStatus'

function App(): React.JSX.Element {
  const { status, loadError, setStatus } = useSettingsStatus()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // The chat is held here, not in ChatView, because the header needs to know when a reply is arriving:
  // the model cannot be changed meanwhile, and no other chat can be opened or started.
  const chat = useChat(ipcReply)
  // Saves the conversation on screen as it goes, and keeps the list of saved ones (D-016, D-017).
  const history = useHistory(chat)
  // The key that matters is the one of the provider that will answer (D-020).
  const missingKey = providerMissingKey(status)

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Frontier App</h1>
        <div className="app-header-actions">
          <button
            type="button"
            className="header-button"
            disabled={chat.isReplying || chat.messages.length === 0}
            title={
              chat.isReplying
                ? 'A new chat can be started when the reply has finished.'
                : chat.messages.length === 0
                  ? 'This chat is empty.'
                  : history.saveError
                    ? 'Start a new chat. This one is not saved, so it would be lost.'
                    : 'Start a new chat. This one stays saved in History.'
            }
            onClick={history.startNew}
          >
            New chat
          </button>
          <button
            type="button"
            className="header-button"
            disabled={chat.isReplying}
            title={
              chat.isReplying
                ? 'History can be opened when the reply has finished.'
                : 'Open a saved chat, or delete one.'
            }
            onClick={() => setHistoryOpen(true)}
          >
            History
          </button>
          <ModelPicker status={status} disabled={chat.isReplying} onStatusChange={setStatus} />
          {history.saveError !== null && (
            <button
              type="button"
              className="app-badge app-badge-warn app-badge-button"
              title={`${history.saveError} Click to try again.`}
              onClick={history.retrySave}
            >
              Not saved
            </button>
          )}
          {missingKey !== null && (
            <span
              className="app-badge app-badge-warn"
              title={`Open Settings to add your ${missingKey.name} API key.`}
            >
              No API key
            </span>
          )}
          <button type="button" className="header-button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>
      <ChatView
        status={status}
        chat={chat}
        conversationId={history.activeId}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <HistoryDialog open={historyOpen} history={history} onClose={() => setHistoryOpen(false)} />
      <SettingsDialog
        open={settingsOpen}
        status={status}
        loadError={loadError}
        onStatusChange={setStatus}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

export default App
