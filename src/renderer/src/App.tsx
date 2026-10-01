import { useState } from 'react'
import ChatView from './chat/ChatView'
import { ipcReply } from './chat/ipcReply'
import { useChat } from './chat/useChat'
import ModelPicker from './settings/ModelPicker'
import SettingsDialog from './settings/SettingsDialog'
import { useSettingsStatus } from './settings/useSettingsStatus'

function App(): React.JSX.Element {
  const { status, loadError, setStatus } = useSettingsStatus()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The chat is held here, not in ChatView, because the header needs to know when a reply is arriving:
  // the model cannot be changed meanwhile.
  const chat = useChat(ipcReply)

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Frontier App</h1>
        <div className="app-header-actions">
          <ModelPicker status={status} disabled={chat.isReplying} onStatusChange={setStatus} />
          {status?.hasKey === false && (
            <span
              className="app-badge app-badge-warn"
              title="Open Settings to add your Anthropic API key."
            >
              No API key
            </span>
          )}
          <button type="button" className="header-button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
      </header>
      <ChatView status={status} chat={chat} onOpenSettings={() => setSettingsOpen(true)} />
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
