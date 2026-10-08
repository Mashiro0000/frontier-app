import { useCallback, useState } from 'react'
import { ATTACHMENT_LIMITS, type AttachmentInfo } from '../../shared/attachments'
import { limitsAreSet } from '../../shared/limits'
import type { TaskId } from '../../shared/rankings'
import ChatBar from './chat/ChatBar'
import ChatView from './chat/ChatView'
import { ipcReply } from './chat/ipcReply'
import { chatFiles } from './chat/attachmentText'
import { useAttachments } from './chat/useAttachments'
import { useChat } from './chat/useChat'
import HistoryDialog from './history/HistoryDialog'
import { useHistory } from './history/useHistory'
import InstructionsDialog from './instructions/InstructionsDialog'
import { useEveryChat } from './instructions/useEveryChat'
import MemoryDialog from './memory/MemoryDialog'
import { useMemory } from './memory/useMemory'
import ProjectsDialog from './projects/ProjectsDialog'
import { projectOf, useProjects } from './projects/useProjects'
import ToolsDialog from './tools/ToolsDialog'
import { useAudit } from './tools/useAudit'
import { anyToolOn, useToolSettings } from './tools/useToolSettings'
import EffortPicker from './settings/EffortPicker'
import { providerMissingKey } from './settings/format'
import LimitsDialog from './settings/LimitsDialog'
import ModelPicker from './settings/ModelPicker'
import SettingsDialog from './settings/SettingsDialog'
import TaskPicker from './settings/TaskPicker'
import { useSettingsStatus } from './settings/useSettingsStatus'

/** No project files: one empty list, so the chat does not draw again for a new one each time. */
const NO_FILES: AttachmentInfo[] = []

function App(): React.JSX.Element {
  const { status, loadError, setStatus } = useSettingsStatus()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  // Set when the person closes the first-run question about spending limits without answering it ("Not now"): it is not asked again until
  // they ask for it (the hint in an empty chat), and meanwhile the main process refuses every request (D-031).
  const [limitsPutOff, setLimitsPutOff] = useState(false)
  // What the person says they are doing. Only the model menu reads it, to mark the models named for it (D-023).
  // It is not saved: it is a hint for the next choice, not a setting.
  const [task, setTask] = useState<TaskId | null>(null)
  // The chat is held here, not in ChatView, because the header and the chat bar need to know when a reply is arriving:
  // the model cannot be changed meanwhile, and no other chat can be opened or started.
  const chat = useChat(ipcReply)
  // Saves the conversation on screen as it goes, and keeps the list of saved ones (D-016, D-017).
  const history = useHistory(chat)
  // The files on the message being written (D-037): copies kept by main, attached with "Attach...", a paste or a drop.
  const attachments = useAttachments()
  // The person's instructions for every chat (D-039): kept by main, which adds them to every request; the page shows them and asks to change them.
  const everyChat = useEveryChat()
  // The person's notes (D-039): kept by main, which sends them with every request; the Memory page shows them and asks to change them.
  const memory = useMemory()
  const [memoryOpen, setMemoryOpen] = useState(false)
  // Text picked with "Remember..." on a message, for the Memory page's box; null when the page was opened from the chat bar.
  const [memoryDraft, setMemoryDraft] = useState<string | null>(null)
  const { reload: reloadMemory } = memory
  const openMemory = useCallback(
    (draft: string | null): void => {
      reloadMemory()
      setMemoryDraft(draft)
      setMemoryOpen(true)
    },
    [reloadMemory]
  )
  const onRemember = useCallback((text: string): void => openMemory(text), [openMemory])
  // The person's projects (D-039, 10.5): kept by main; the chat on screen belongs to one or none (saved with it, in its file).
  const projects = useProjects()
  const [projectsOpen, setProjectsOpen] = useState(false)
  const chatProject = projectOf(projects.status, chat.project)
  // The audit log of tool calls (D-041): kept by main; the Tools page shows it, and asks for the export and the deletion.
  const audit = useAudit()
  const [toolsOpen, setToolsOpen] = useState(false)
  const { reload: reloadAudit } = audit
  // Which tools are on and the caps (D-041, 11.4): kept by main, which reads them at every reply; the Tools page changes them, and the Stop button reads them.
  const toolSettings = useToolSettings()
  const { reload: reloadToolSettings } = toolSettings
  // A message carries at most ten files, and a chat (whose files are sent again with every message) at most fifty.
  const attachFull =
    attachments.files.length >= ATTACHMENT_LIMITS.perMessage ||
    chatFiles(chat.messages, attachments.files).length >= ATTACHMENT_LIMITS.perChat
  // The key that matters is the one of the provider that will answer (D-020).
  const missingKey = providerMissingKey(status)
  // No limits chosen yet: asked for before the first message, and until they are chosen nothing is sent (D-031).
  const needsLimits = status !== null && !limitsAreSet(status.limits)

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
        needsLimits={needsLimits}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLimits={() => setLimitsPutOff(false)}
        attachments={attachments}
        onRemember={onRemember}
        projectFiles={chatProject?.files ?? NO_FILES}
        toolsOn={anyToolOn(toolSettings.status)}
      />
      {/* New chat, History and Instructions live under the message box, not in the header, so the header stays one row (D-029). */}
      <ChatBar
        isReplying={chat.isReplying}
        messageCount={chat.messages.length}
        instructions={chat.instructions}
        everyChat={everyChat.status}
        memory={memory.status}
        onOpenMemory={() => openMemory(null)}
        projectName={chatProject?.name ?? null}
        onOpenProjects={() => {
          projects.reload()
          setProjectsOpen(true)
        }}
        onOpenTools={() => {
          reloadAudit()
          reloadToolSettings()
          setToolsOpen(true)
        }}
        saveFailed={history.saveError !== null}
        onNewChat={() => history.startNew()}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenInstructions={() => {
          everyChat.reload()
          setInstructionsOpen(true)
        }}
        onAttach={attachments.pick}
        attachDisabled={attachments.busy || attachFull}
        attachTitle={
          attachments.busy
            ? 'Files are being attached.'
            : attachFull
              ? attachments.files.length >= ATTACHMENT_LIMITS.perMessage
                ? `A message can carry at most ${ATTACHMENT_LIMITS.perMessage} files.`
                : `A chat can hold at most ${ATTACHMENT_LIMITS.perChat} files. Start a new chat for more.`
              : 'Attach images, PDFs or text files to your message. You choose them in a Windows dialog; the app keeps a copy and sends it to the model.'
        }
      />
      <HistoryDialog
        open={historyOpen}
        history={history}
        projects={projects.status}
        onClose={() => setHistoryOpen(false)}
      />
      <ProjectsDialog
        open={projectsOpen}
        projects={projects}
        chatProject={chatProject?.id ?? null}
        onChatProject={chat.setProject}
        onNewChatIn={(id) => history.startNew(id)}
        onClose={() => setProjectsOpen(false)}
      />
      <ToolsDialog
        open={toolsOpen}
        audit={audit}
        settings={toolSettings}
        onClose={() => setToolsOpen(false)}
      />
      <MemoryDialog
        open={memoryOpen}
        memory={memory}
        draft={memoryDraft}
        projects={projects.status}
        onClose={() => setMemoryOpen(false)}
      />
      <InstructionsDialog
        open={instructionsOpen}
        instructions={chat.instructions}
        everyChat={everyChat.status}
        onSave={chat.setInstructions}
        onEveryChatSaved={everyChat.setStatus}
        onClose={() => setInstructionsOpen(false)}
      />
      {status !== null && (
        <LimitsDialog
          open={needsLimits && !limitsPutOff}
          limits={status.limits}
          onSaved={setStatus}
          onClose={() => setLimitsPutOff(true)}
        />
      )}
      <SettingsDialog
        open={settingsOpen}
        status={status}
        loadError={loadError}
        onStatusChange={setStatus}
        onClose={() => setSettingsOpen(false)}
        conversationId={history.activeId}
        onChatStorageChanged={history.reload}
      />
    </div>
  )
}

export default App
