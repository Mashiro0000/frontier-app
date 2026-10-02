import { useState } from 'react'
import type { TaskId } from '../../shared/rankings'
import ChatBar from './chat/ChatBar'
import ChatView from './chat/ChatView'
import { ipcReply } from './chat/ipcReply'
import { useChat } from './chat/useChat'
import HistoryDialog from './history/HistoryDialog'
import { useHistory } from './history/useHistory'
import InstructionsDialog from './instructions/InstructionsDialog'
import EffortPicker from './settings/EffortPicker'
import { providerMissingKey } from './settings/format'
import ModelPicker from './settings/ModelPicker'
import SettingsDialog from './settings/SettingsDialog'
import TaskPicker from './settings/TaskPicker'
import { useSettingsStatus } from './settings/useSettingsStatus'

function App(): React.JSX.Element {
  const { status, loadError, setStatus } = useSettingsStatus()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  // What the person says they are doing. Only the model menu reads it, to mark the models named for it (D-023).
  // It is not saved: it is a hint for the next choice, not a setting.
  const [task, setTask] = useState<TaskId | null>(null)
  // The chat is held here, not in ChatView, because the header and the chat bar need to know when a reply is arriving:
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
          <TaskPicker status={status} task={task} onChange={setTask} />
          <ModelPicker
            status={status}
            task={task}
            disabled={chat.isReplying}
            onStatusChange={setStatus}
          />
          <EffortPicker status={status} disabled={chat.isReplying} onStatusChange={setStatus} />
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
      {/* New chat, History and Instructions live under the message box, not in the header, so the header stays one row (D-029). */}
      <ChatBar
        isReplying={chat.isReplying}
        messageCount={chat.messages.length}
        instructions={chat.instructions}
        saveFailed={history.saveError !== null}
        onNewChat={history.startNew}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenInstructions={() => setInstructionsOpen(true)}
      />
      <HistoryDialog open={historyOpen} history={history} onClose={() => setHistoryOpen(false)} />
      <InstructionsDialog
        open={instructionsOpen}
        instructions={chat.instructions}
        onSave={chat.setInstructions}
        onClose={() => setInstructionsOpen(false)}
      />
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
