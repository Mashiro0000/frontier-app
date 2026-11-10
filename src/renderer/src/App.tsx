import { useCallback, useEffect, useState } from 'react'
import { ATTACHMENT_LIMITS, type AttachmentInfo } from '../../shared/attachments'
import { limitsAreSet } from '../../shared/limits'
import type { TaskId } from '../../shared/rankings'
import { useRail } from './appearance'
import { IconExperts, IconGlobe, IconImage } from './icons'
import ChatBar from './chat/ChatBar'
import ChatView from './chat/ChatView'
import { ipcReply } from './chat/ipcReply'
import { chatFiles } from './chat/attachmentText'
import { useAttachments } from './chat/useAttachments'
import { useChat } from './chat/useChat'
import GalleryDialog from './images/GalleryDialog'
import { useImageStatus } from './images/imageStatus'
import MakeImageDialog from './images/MakeImageDialog'
import HistoryDialog from './history/HistoryDialog'
import SearchDialog from './history/SearchDialog'
import ShortcutsDialog from './ShortcutsDialog'
import LibraryDialog from './library/LibraryDialog'
import ExpertsDialog from './experts/ExpertsDialog'
import ImageStudioDialog from './images/ImageStudioDialog'
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
import { useSettingsStatus } from './settings/useSettingsStatus'
import Sidebar from './sidebar/Sidebar'

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
  // (21.3, D-053) Auto: a model picked by rules for each message. For this run of the app only (off at every start).
  const [auto, setAuto] = useState(false)
  // (21.5, D-053) Search chats is open.
  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // (22.1, 22.2, D-054) The Library and Experts are open.
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [libraryVisit, setLibraryVisit] = useState(0) // each opening is a fresh one, as the gallery's
  const [expertsOpen, setExpertsOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  // The chat is held here, not in ChatView, because the header and the chat bar need to know when a reply is arriving:
  // the model cannot be changed meanwhile, and no other chat can be opened or started.
  const chat = useChat(ipcReply)
  // (21.5, D-053) Ctrl+K opens Search chats (not while a reply arrives, as its button).
  const replying = chat.isReplying
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (!replying) setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [replying])
  // Saves the conversation on screen as it goes, and keeps the list of saved ones (D-016, D-017).
  const history = useHistory(chat)
  // (24.4, D-056) A page fills the chat area and leaves the sidebar in view. The page is a modal dialog, so a click beside it lands on the
  // dialog itself: the page closes, and the click goes on to the button under the pointer (another page, a chat, New chat, Settings).
  useEffect(() => {
    // On the press, not the click: the press is what takes the keyboard out of a text field, and by the click nothing says it was in use.
    const onPress = (event: MouseEvent): void => {
      const page = event.target
      if (!(page instanceof HTMLDialogElement)) return
      if (!page.matches('.studio, .experts, .projects, .library, .history, .tools')) return
      const box = page.getBoundingClientRect()
      if (event.clientX >= box.left && event.clientY >= box.top) return // the page's own margin, not the sidebar
      // requestClose asks the page first: one that is busy (a file being added, a picture being made) or holds half-written text stays.
      if (page.querySelector('textarea:focus, input[type="text"]:focus') !== null) return
      page.requestClose()
      if (page.open) return
      const under = document.elementFromPoint(event.clientX, event.clientY)
      if (under instanceof Element) under.closest('button')?.click()
    }
    window.addEventListener('mousedown', onPress)
    return () => window.removeEventListener('mousedown', onPress)
  }, [])
  // (23.6, D-055) Ctrl+Shift+O a new chat (as the sidebar's button: not while a reply arrives, not from an empty chat), Esc stops a reply, Ctrl+/ lists the keys.
  // None works while a dialog is open (the dialog has the keyboard), and none sends anything.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (document.querySelector('dialog[open]') !== null) return
      const key = event.key.toLowerCase()
      if (event.ctrlKey && event.shiftKey && !event.altKey && key === 'o') {
        event.preventDefault()
        if (!replying && chat.messages.length > 0) history.startNew()
      } else if (event.ctrlKey && !event.shiftKey && !event.altKey && key === '/') {
        event.preventDefault()
        setShortcutsOpen(true)
      } else if (
        event.key === 'Escape' &&
        replying &&
        !event.defaultPrevented &&
        !event.isComposing
      ) {
        chat.stop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [replying, chat, history])
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
  // Pictures (D-048): the switch, the "Make an image" dialog and the gallery. A picture made is put into the chat as a request of the person's (never sent to the model).
  const imageStatus = useImageStatus()
  const [makeOpen, setMakeOpen] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  // Each opening of the gallery is a fresh one (its list is read again; nothing of the last visit lingers).
  const [galleryVisit, setGalleryVisit] = useState(0)
  const { adopt, say } = attachments
  const usePicture = useCallback(
    (id: string): void => {
      void window.api.images
        .useInChat(id)
        .then((result) => (result.ok ? adopt(result.file) : say(result.error)))
        .catch(() => say('The picture could not be attached.'))
    },
    [adopt, say]
  )
  const chosenModel = status?.models.find((model) => model.id === status.selectedModelId)
  // A message carries at most ten files, and a chat (whose files are sent again with every message) at most fifty.
  const attachFull =
    attachments.files.length >= ATTACHMENT_LIMITS.perMessage ||
    chatFiles(chat.messages, attachments.files).length >= ATTACHMENT_LIMITS.perChat
  // The key that matters is the one of the provider that will answer (D-020).
  const missingKey = providerMissingKey(status)
  // No limits chosen yet: asked for before the first message, and until they are chosen nothing is sent (D-031).
  const needsLimits = status !== null && !limitsAreSet(status.limits)
  // The sidebar folded to a rail of icons (D-051): the person's choice, kept on this computer.
  const rail = useRail()
  // The chat's title over the messages: its saved title, or "New chat" until it is saved.
  const chatTitle =
    history.conversations?.find((conversation) => conversation.id === history.activeId)?.title ??
    'New chat'
  const openTools = (): void => {
    reloadAudit()
    reloadToolSettings()
    setToolsOpen(true)
  }

  return (
    <div className={rail ? 'app app-rail' : 'app'}>
      <Sidebar
        isReplying={chat.isReplying}
        messageCount={chat.messages.length}
        history={history}
        onNewChat={() => history.startNew()}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenTools={openTools}
        onOpenSettings={() => setSettingsOpen(true)}
        onSearch={() => setSearchOpen(true)}
        onOpenStudio={() => setStudioOpen(true)}
        onOpenExperts={() => setExpertsOpen(true)}
        onOpenProjects={() => {
          projects.reload()
          setProjectsOpen(true)
        }}
        onOpenLibrary={() => {
          setLibraryVisit((n) => n + 1)
          setLibraryOpen(true)
        }}
        page={
          studioOpen
            ? 'studio'
            : expertsOpen
              ? 'experts'
              : projectsOpen
                ? 'projects'
                : libraryOpen
                  ? 'library'
                  : historyOpen
                    ? 'history'
                    : toolsOpen
                      ? 'tools'
                      : null
        }
      />
      <div className="app-main">
        <header className="app-header">
          <h2 className="chat-title" title={chatTitle}>
            {chatTitle}
          </h2>
          {/* The warnings, at the right (D-052); the title is at the left, as Claude's (the menus are under the message box). */}
          <div className="app-header-badges">
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
          toolsOn={anyToolOn(toolSettings.status, toolSettings.workspace, toolSettings.programs)}
          auto={auto}
          task={task}
          chips={
            // (21.4, D-053) Under the box of an empty chat, as AI Fiesta's chips: ways in to what the app can do. Each opens what its button opens.
            <div className="empty-chips" role="group" aria-label="Start with">
              {imageStatus?.on === true && (
                <button type="button" className="chip chip-start" onClick={() => setMakeOpen(true)}>
                  <IconImage />
                  Make an image
                </button>
              )}
              <button type="button" className="chip chip-start" onClick={openTools}>
                <IconGlobe />
                Web search
              </button>
              {/* (23.4, D-055) Projects and Instructions are in the box itself, so they are not repeated here. */}
              <button
                type="button"
                className="chip chip-start"
                onClick={() => setExpertsOpen(true)}
              >
                <IconExperts />
                Experts
              </button>
            </div>
          }
          menus={
            // Under the message box, at the right (D-052, as Claude's model menu). "app-header-actions": the name the checks know the group by,
            // from the time it sat in the header. (23.3, D-055) One pill: the model and its effort; the Task menu is in the model chooser.
            <div
              className="app-header-actions composer-menus model-pill"
              role="group"
              aria-label="Model and effort"
            >
              <ModelPicker
                status={status}
                task={task}
                onTask={setTask}
                disabled={chat.isReplying}
                onStatusChange={setStatus}
                auto={auto}
                onAuto={setAuto}
              />
              <EffortPicker status={status} disabled={chat.isReplying} onStatusChange={setStatus} />
            </div>
          }
          toolbar={
            // The chat's own buttons, in the message box (D-051): New chat, History and Tools are in the sidebar, Settings at its foot.
            <ChatBar
              isReplying={chat.isReplying}
              instructions={chat.instructions}
              everyChat={everyChat.status}
              memory={memory.status}
              onOpenMemory={() => openMemory(null)}
              projectName={chatProject?.name ?? null}
              onOpenProjects={() => {
                projects.reload()
                setProjectsOpen(true)
              }}
              onOpenInstructions={() => {
                everyChat.reload()
                setInstructionsOpen(true)
              }}
              onAttach={attachments.pick}
              imagesOn={imageStatus?.on === true}
              onMakeImage={() => setMakeOpen(true)}
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
          }
        />
      </div>
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <SearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenChat={history.open}
      />
      <LibraryDialog
        key={`library-${libraryVisit}`}
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onOpenChat={history.open}
      />
      <ExpertsDialog
        open={expertsOpen}
        replying={chat.isReplying}
        onClose={() => setExpertsOpen(false)}
        onStart={(expert) => {
          // A new chat whose own instructions are the expert's (the person sees them on the Instructions button), and the expert's task.
          history.startNew()
          chat.setInstructions(expert.instructions)
          setTask(expert.task)
          setExpertsOpen(false)
        }}
      />
      <ImageStudioDialog
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        onOpenGallery={() => {
          setGalleryVisit((n) => n + 1)
          setGalleryOpen(true)
        }}
        onOpenSettings={() => {
          setStudioOpen(false)
          setSettingsOpen(true)
        }}
      />
      <MakeImageDialog
        open={makeOpen}
        chatId={history.activeId}
        onMade={chat.addPicture}
        onOpenGallery={() => {
          setMakeOpen(false)
          setGalleryVisit((n) => n + 1)
          setGalleryOpen(true)
        }}
        onOpenSettings={() => {
          setMakeOpen(false)
          setSettingsOpen(true)
        }}
        onClose={() => setMakeOpen(false)}
      />
      <GalleryDialog
        key={`gallery-${galleryVisit}`}
        open={galleryOpen}
        canAttach={chosenModel?.imageInput === true}
        onUse={usePicture}
        onClose={() => setGalleryOpen(false)}
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
