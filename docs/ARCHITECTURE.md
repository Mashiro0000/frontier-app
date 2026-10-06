# Architecture (v0.1)

> Stub. Describes what exists at the end of Stage 4 and what is planned. Update as the app grows.

## What this is

Frontier App is a desktop AI chat app built with Electron, Vite, React and TypeScript.
It is a working chat window: you save your own Anthropic API key in Settings, and replies stream in from
Claude (D-012). The page never sees the key or the network. The main process holds the key, makes the
only network call (to the Anthropic API) and streams the reply back to the page. Which Claude model answers
is a choice from a registry of models (`registry/models.json`, D-014); the main process holds the choice and
saves it (D-015). Conversations are saved on disk as they go, one file each, and can be reopened (D-016, D-017).

## Process model

Electron runs three kinds of code. Each has its own folder under `src/`.

| Folder         | Runs in                       | Job                                                                     |
| -------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `src/main`     | Main process (Node.js)        | Creates windows, talks to the OS, owns the API key and the network call |
| `src/preload`  | Bridge (runs before the page) | Exposes a small, safe API from main to the renderer                     |
| `src/renderer` | Browser window (React)        | The user interface                                                      |
| `src/shared`   | Imported by any of them       | The contract between page and main (`ipc.ts`) and checks both sides run |

The renderer should never touch Node.js or the network for model calls directly. It asks main
through the preload bridge (IPC).

Stage 1 changed only `src/renderer`. Stage 2 added the files below (see Security notes), Stage 3 added or
changed the ones marked (3), Stage 4 the ones marked (4), Stage 5 the ones marked (5), Stage 6 the ones marked (6), Stage 7 the ones
marked (7), Stage 8 the ones marked (8), Stage 8b the ones marked (8b), and Stage 9 the ones marked (9):

| File                                         | Job                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main/index.ts`                          | Creates the sandboxed window, wires the navigation lock, registers the message handlers. (4) Holds the quit until saves finish                                                                                                                                                                                                                                                                   |
| `src/main/security.ts`                       | Plain functions: is this URL the app's own page? may it be opened in the browser?                                                                                                                                                                                                                                                                                                                |
| `src/main/ipc.ts`                            | The message handlers. Each one first checks that the app's own page is calling. (4) The four `history:` handlers. (8) `usage:summary`, and the one ledger (8b) Four more `history:` handlers: back up, look, add, cancel. (8b.3) Three more: `history:storage`, `history:encrypt`, `history:decrypt`; the store is given the secure storage and the rule for how a chat may be written           |
| `src/main/keyStore.ts`                       | Saves, reads and deletes the API keys: the Electron side (the secure storage and the data folder) of the credential store. (5) One key per provider. (8b.3) Also hands out the secure storage itself (`secureStorage`), which the saved chats use when the person turns encryption on                                                                                                            |
| `src/main/credentialStore.ts`                | (5) One encrypted file per provider (`credentials.<provider>.json`), tied to its provider; reads the old `credentials.json` as Anthropic's key. No Electron imports                                                                                                                                                                                                                              |
| `src/main/baseUrl.ts`                        | (5) The test-only address override (`FRONTIER_API_BASE_URL`), for replies and for Test key; never in an installed app                                                                                                                                                                                                                                                                            |
| `src/main/chat.ts`                           | Runs each reply: reads the key, asks the model's provider adapter, sends text to the page as events. (5) Provider-neutral. (8) Writes each request to the usage ledger before it is sent and again when it ends, and tells the page what the reply cost. (8.3) Asks first before a large request                                                                                                 |
| `src/main/providers/types.ts`                | (5) The provider layer's vocabulary: `ProviderAdapter` (`listModels`, `stream`, `usage`, `normalizeError`), the neutral message and request, usage and errors. No Electron imports                                                                                                                                                                                                               |
| `src/main/providers/openai.ts`               | (5) The OpenAI adapter (D-022): the Responses API through OpenAI's own SDK, `store: false`, environment pinned; usage with cached tokens taken out of the input                                                                                                                                                                                                                                  |
| `src/main/providers/anthropic.ts`            | (5) The Anthropic adapter: the one place that calls Anthropic's API, through the official SDK. It was `provider.ts`                                                                                                                                                                                                                                                                              |
| `src/main/providers/request.ts`              | (5) The app's own rules for a reply, applied once for every provider: system prompt, reply ceiling, joining consecutive turns (D-013). (7) The person's instructions for the chat are added to the system prompt AFTER the app's rules (D-027)                                                                                                                                                   |
| `src/main/providers/errors.ts`               | (5) The sentences for a failure, shared by every provider; adds the request id and scrubs the key                                                                                                                                                                                                                                                                                                |
| `src/main/providers/usage.ts`                | (5) Reading token counts out of a provider's usage report                                                                                                                                                                                                                                                                                                                                        |
| `src/main/providers/index.ts`                | (5) The adapter for each provider: a table that must be complete, or it does not compile                                                                                                                                                                                                                                                                                                         |
| `src/main/registry.ts`                       | (3) The registry file, embedded in the build and checked once at startup                                                                                                                                                                                                                                                                                                                         |
| `src/main/rankings.ts`                       | (6) The rankings file, embedded in the build and checked once at startup; optional: if it is broken the app only loses its suggestions                                                                                                                                                                                                                                                           |
| `src/main/models.ts`                         | (3) Which model answers: the saved choice (`preferences.json`) or the registry's default; changes run one at a time. (7) Also the effort kept per model, written with the model in one file                                                                                                                                                                                                      |
| `src/shared/effort.ts`                       | (7) The effort levels: sorting a model's levels, reading the saved `efforts` forgivingly, resolving the level a reply asks for (the saved one if the model still lists it), and what the page is told (D-024)                                                                                                                                                                                    |
| `src/preload/index.ts`                       | Builds `window.api`, the only thing the page can ask main for. (4) Gained `history` (8b) `history.exportChats`, `restoreLook`, `restoreApply`, `restoreCancel`: none takes a path. (8b.3) `history.storage`, `encryptChats`, `decryptChats`: none takes anything.                                                                                                                                |
| `src/preload/index.d.ts`                     | Tells the renderer's TypeScript what `window.api` looks like                                                                                                                                                                                                                                                                                                                                     |
| `src/shared/ipc.ts`                          | Every message that crosses the boundary: types, channel names. (4) The history types and `HISTORY_LIMITS`. (8) `usage.summary`, the `usage` event, `conversationId`. (8.3) The `confirm` event, `chat.confirm`, `settings.setAskFirst` (8b) The backup types (`BackupRequest`, `RestorePreview`). (8b.3) `ChatStorageStatus` (eight facts, no key and no path), `ChatStorageResult`.             |
| `src/shared/validate.ts`                     | `checkApiKey`, `checkChatRequest`, `checkModelChoice`: the page may use them for feedback, main runs them again. (4) `checkConversationId`, `checkConversationSave`, `checkSavedMessages` (8b) `checkBackupRequest`.                                                                                                                                                                             |
| `src/shared/registry.ts`                     | (3) The shape of the registry file, `parseRegistry` (the strict check), and `toModelOption` (what the page may know about a model). (8) Four prices per model                                                                                                                                                                                                                                    |
| `src/shared/rankings.ts`                     | (6) The task list, the shape of the rankings file, `parseRankings` (the strict check) and `suggestionsFor` (which rows can be used now)                                                                                                                                                                                                                                                          |
| `src/renderer/src/settings/`                 | (3) The Settings dialog, the model menu in the header, and the hook that asks main for the settings status. (5) One key section per provider (`ProviderKeySection`: add, test, remove) . (6) The Task menu, and the "(suggested)" marks in the model menu                                                                                                                                        |
| `src/main/conversationStore.ts`              | (4) The saved conversations: one JSON file each, saved copy-then-delete, read with a recovery rule, listed from memory. No Electron imports. (7) Version 3 holds the chat's instructions; versions 1 and 2 are still read (D-027) (8b) `inspect`, `add` (restore; never replaces). (8b.3) A chat's file is plain or sealed; asks `writeMode` before every write; `counts`, `blocked`, `conform`. |
| `src/main/backup.ts`                         | (8b) The backup file (D-034): JSON Lines, a checksum on every chat, a last line with the count; a reader that never holds more than one line; a writer that reads its file back first. No Electron imports                                                                                                                                                                                       |
| `src/main/backupService.ts`                  | (8b) The flow around a backup (D-034): what to back up, the look at a file, the one-use token, a restore that never replaces. The two dialogs are handed in. No Electron imports                                                                                                                                                                                                                 |
| `src/main/backupDialogs.ts`                  | (8b) The system's save and open dialogs for backups: the only file that opens one. (8b.3) And the message box that asks before the chats go back to plain files. (9.2) And the open dialog for Attach...                                                                                                                                                                                         |
| `src/main/chatFile.ts`                       | (8b.3) A sealed chat file (D-035): the envelope `{"format":"frontier-chat-encrypted","v":1,"data":...}`, sealing and opening, the limit on its size, the first bytes that mark one. No Electron imports                                                                                                                                                                                          |
| `src/main/chatProtection.ts`                 | (8b.3, 8b.4) How chats are kept: `chat-encryption.json` (the choice and a check), and the ONE rule for how the next chat may be written, or that none may be (the key cannot be used). No Electron imports                                                                                                                                                                                       |
| `src/main/chatEncryptionService.ts`          | (8b.3) Turning encryption on (the backup first, then the choice, then every chat) and off (the system asks first), and the wording of the question. No Electron imports                                                                                                                                                                                                                          |
| `src/renderer/src/settings/ChatStorage*.ts*` | (8b.3) `ChatStorageSection` (Settings > Saved chats) and `useChatStorage`: what the main process says about how the chats are kept, and the two buttons                                                                                                                                                                                                                                          |
| `src/renderer/src/history/`                  | (4) `useHistory` (autosave and the list), `HistoryDialog` (open and delete), and the conversions between the chat and what is saved (8b) `useBackup` and `RestorePreviewPanel`; Export on each row. (8b.3) The list also carries how the files are kept, and the dialog says so.                                                                                                                 |
| `src/renderer/src/markdown/`                 | (7) A reply as Markdown (D-025): `parse.ts` (the reader), `Markdown.tsx` (a closed set of elements), `CodeBlock.tsx` (Copy), `LinkConfirm.tsx` (a link asks first)                                                                                                                                                                                                                               |
| `src/renderer/src/instructions/`             | (7) The Instructions dialog (D-027): the person's own text for one chat, a draft until Save, with the count, the limit and what it is for, who gets it and where it is kept                                                                                                                                                                                                                      |
| `src/main/usageLedger.ts`                    | (8) The usage ledger (D-030): one plain file of JSON lines, appended to, a later line replacing an earlier one with the same id; a cut-off or damaged line skipped and counted; a request that cannot be written down is refused. No Electron imports                                                                                                                                            |
| `src/shared/usage.ts`                        | (8) Cost from four buckets and four prices, the guess when a provider gives no report, the strict reader of one ledger line, and the sums (this chat, today, this month). No Electron imports                                                                                                                                                                                                    |
| `src/renderer/src/settings/UsageSection.tsx` | (8) Settings > Usage: this chat, today and this month, asked of main each time Settings opens. (8.2) Says how much of each limit has gone ("of $5.00")                                                                                                                                                                                                                                           |
| `src/shared/limits.ts`                       | (8.2) What a spending limit is (an amount in whole cents, "No limit" on purpose, or not chosen), how an amount is typed, what the page may hand over, what `limits.json` holds and how a damaged one is read, and `checkAgainstLimits` (the sentence that refuses a request). No Electron imports                                                                                                |
| `src/main/limits.ts`                         | (8.2) The store of the limits: `limits.json`, written in place and read back, read once and kept; a missing or damaged file is "not chosen". No Electron imports                                                                                                                                                                                                                                 |
| `src/renderer/src/settings/Limits*.tsx`      | (8.2) `LimitsForm` (two amounts, each with "No limit"), `LimitsDialog` (asked before the first message, can be put off) and `LimitsSection` (in Settings). (8.3) The amount box is `AmountField`, shared with `AskFirstSection`                                                                                                                                                                  |
| `src/shared/askFirst.ts`                     | (8.3) The question before a large request, the pure part: the estimate (`estimateRequest`), when to ask (`needsConfirmation`), how an amount is typed, what the page may hand over, and what `ask-first.json` holds (damage reads as the default, never as "Never ask"). No Electron imports                                                                                                     |
| `src/main/askFirst.ts`                       | (8.3) The store of the choice: `ask-first.json`, written in place and read back, read once and kept; `read` never throws (damage and an unreadable file mean the default). No Electron imports                                                                                                                                                                                                   |
| `src/main/confirmation.ts`                   | (8.3) The waiting room: a large request waits under "<window id>:<stream id>" until the person says yes; only a waiting question hears a yes; a Stop, a reload or a closed window declines. No Electron imports                                                                                                                                                                                  |
| `src/renderer/src/chat/LargeRequest*.tsx`    | (8.3) `LargeRequestDialog`: what the request could cost at the most (main's figures, rounded up), "Don't send" first and focused, Escape is no. `settings/AskFirstSection.tsx` chooses the amount                                                                                                                                                                                                |
| `src/shared/attachments.ts`                  | (9.1) What the page may know about an attachment (`AttachmentInfo`, `AttachedFile`), the caps (`ATTACHMENT_LIMITS`, D-037), the id check and the name rule (`cleanFileName`). No imports                                                                                                                                                                                                         |
| `src/main/attachmentFormats.ts`              | (9.1) What a file is, from its bytes: the first bytes, an image's header (size, animation, EXIF orientation) read before anything decodes it, metadata taken out by rewriting the bytes, a PDF's pages, the text rule. No Electron, no package                                                                                                                                                   |
| `src/main/attachmentStore.ts`                | (9.1) The attachments folder: `prepare` (every check and cap on the way in), `readLocalFile` (a file the person chose), copies named by their SHA-256 and read back, sealed like the chats, `deleteUnused` and `sweep`. No Electron imports                                                                                                                                                      |
| `src/main/attachmentImages.ts`               | (9.1) Electron's `nativeImage` for attachments: a PNG or JPEG made smaller, turned upright (it ignores EXIF orientation by itself), PNG to JPEG when too heavy, and the chip's small picture                                                                                                                                                                                                     |
| `src/main/attachmentService.ts`              | (9.2) Getting files in: `pick` (the system's open dialog, handed in; each file read by main and kept), `addBytes` (a pasted or dropped file: a name and bytes, never a path), `discard`. No Electron imports                                                                                                                                                                                     |
| `src/renderer/src/chat/useAttachments.ts`    | (9.2) The files on the message being written: Attach..., a paste and a drop hand them to main; the cap of ten; taking one off                                                                                                                                                                                                                                                                    |
| `src/renderer/src/chat/AttachmentChips.tsx`  | (9.2) The chips above the message box (a small picture made by main, what it is, what was done to it, Remove) and where the files go; `attachmentText.ts` holds the words                                                                                                                                                                                                                        |

### Settings and the API keys

```
Settings dialog --window.api.settings.setApiKey(provider, key)--> preload --> ipc.ts guard --> keyStore --> credentialStore
 (one section        one named function, no ipcRenderer                       is the caller the app's      (Electron glue)  credentials.<provider>.json
  per provider)                                                               own page? checkKeySubmission                  encrypted by the OS
                                                                              again
   ... testApiKey(provider) --> ipc.ts: the SAVED key --> adapterFor(provider).listModels()  (free: no tokens) --> a count, or a sentence
```

There is one key per provider, each in its own small file in the per-user data folder
(`app.getPath('userData')`): `credentials.anthropic.json`, `credentials.openai.json`, ... Each holds
`{ version: 2, provider, key }` with the key encrypted by Electron's `safeStorage`, and a file is only ever
used for the provider it says it is for. The old single `credentials.json` is still read, as Anthropic's key, until
that key is saved or removed again. `credentialStore.ts` does the keeping and imports nothing from Electron, so it is
checked under plain Node; `keyStore.ts` hands it Electron's secure storage and the data folder.

The page can ask "which providers have a key?", hand over a new key for one, remove one, and ask for one to be
tested. It can never read a key back: no key is part of any reply, and "Test key" always uses the key that is saved,
never one the page supplies. See DECISIONS.md D-010, D-011 and D-020.

### Choosing a model

```
header menu --window.api.settings.setModel(id)--> preload --> ipc.ts guard --> inOrder (one at a time)
 (page)        one named function                 is the caller the app's      checkModelChoice, chooseModel (the id must be
                                                  own page?                    in the registry: checked twice) --> preferences.json
```

The registry says which models exist; `models.ts` keeps the person's choice (or the registry's default if there
is none, or if the saved one is no longer offered). `getStatus` hands the page the list (names, descriptions,
sizes, prices, never how a model is called) and the current choice. The model is fixed when a reply starts
(`chat.ts`), and the menu is disabled while a reply is arriving. See DECISIONS.md D-014 and D-015.

### Choosing the effort

The **Effort** menu (`EffortPicker.tsx`) calls `window.api.settings.setEffort(modelId, level)`; it goes through the same guard, the same one-at-a-time
queue and the same file as the model choice. Main checks the model and the level against that model's own registry entry (`checkEffortChoice`),
checks again where it saves (`chooseEffort`), and every reply checks the saved level against the model's list once more (`resolveEffort`). The
chat request carries no effort: `chat.ts` takes it from main, fixed for the whole reply, and the adapters send `StreamRequest.effort`. The page is
told only the levels, the selected one and the registry's pick for the chosen model. See DECISIONS.md D-024.

### Saving conversations

```
page: useChat.messages --useHistory (on every change; a streaming reply at most once a second)--> window.api.history.save({ id, messages, instructions })
        |                                                                              preload --> ipc.ts guard --> checkConversationSave
        |                                                                                  (the title and dates are not the page's)
        |                                                                                              |
        |                                             conversationStore: one at a time, in order. <id>.json.tmp written + read back,
        |                                             copied over <id>.json + read back, .tmp deleted   --> conversations/<id>.json
        +-- History dialog --list / load / remove--> the same guard and validation, the same store
```

The page holds the conversation while it is being written and hands over a snapshot after each change that
matters; main checks it and writes it (D-017). Nothing is saved until there is a message. A file is written
as `<id>.json.tmp` first, then copied over `<id>.json`, so a crash in the middle leaves either a whole
`.tmp` (which wins when the folder is read) or a cut-off one (which is ignored): see D-016. The quit is held
until the saves in progress have finished (`before-quit`, at most 5 s). The files are plain JSON in the
per-user data folder, in `conversations/`, and the History dialog shows where.

Since Stage 5.4 the file is `"version": 2` (D-021): every reply in it says which `provider` and `model` wrote it (`null` where that
is not known), and the person's own messages carry neither. A version 1 file (Stages 2-4) is read as a version 2 one, with the
provider `anthropic` and the model `null`, and stays version 1 on disk until the conversation is next saved: reading never writes.

Since Stage 7.4 the file is `"version": 3` (D-027): it also holds `instructions`, the person's own text for the chat (`""` for none), between
the dates and the messages. A version 1 or 2 file is read as a version 3 one with no instructions, and stays as it is on disk until the
conversation is next saved (reading never writes, as before). In a version 3 file the field must be present and usable (text, at most 8,000
characters): a file whose instructions are not is counted as unreadable and left alone, like any other damaged file. A file of version 4 or
later was made by another build and is left alone.

### Backing up and restoring chats

```
page: History dialog --exportChats({ scope: 'all' | 'one', id })--> preload --> ipc.ts guardedForWindow (sender guard + the window that asked)
                                                                        |  checkBackupRequest (no path can be in it)
                                                                        v
                                backupService: the system's SAVE dialog (backupDialogs.ts, main's own, modal) --> the person picks the place
                                        |  refused inside the data folder (links followed)  --> backup.ts writeBackup:
                                        |  <name>.part written + flushed + READ BACK, copied over <name>, READ BACK, .part removed
        --restoreLook()--> the system's OPEN dialog --> readBackup (adds nothing) --> a preview + a one-use token (10 minutes, the file's size and time)
        --restoreApply(token)--> the file read AGAIN, every chat checked again --> store.add (never replaces; a taken id becomes a copy)
```

A backup is one JSON Lines file (D-034): a header, one line per chat with its own SHA-256, and a last line with the count, so a cut-off file still gives
back the chats before the cut and says it is not whole. The page never names a file: the person chooses in the system's dialogs, which main opens, and
the page is told where a backup went only afterwards. `backupService.ts` and `backup.ts` have no Electron imports (the dialogs are handed in), so the plain-Node
suites play the dialogs themselves; the window suite replaces `dialog.showSaveDialog` and `showOpenDialog` from main's inspector.

### How saved chats are kept: plain, or encrypted (8b.3, 8b.4)

```
person: Settings > Saved chats --encryptChats()--> ipc.ts guardedForWindow --> chatEncryptionService.encrypt   (inside the backup service's lock)
        1. the secure storage is there, and (if already on) its key opens the check        else: refused, nothing changed
        2. backupService.backUpAllBeforeEncrypting: the system's SAVE dialog --> a verified backup of ALL chats     else (closed, or it failed): nothing changed
        3. chatProtection.turnOn: encrypt + decrypt a check, write chat-encryption.json {"encrypt":true,"check":...}, read it back
        4. store.conform: every readable chat rewritten as a sealed file, one per turn, each proved by opening it, then read again
        --decryptChats()--> the system's MESSAGE BOX (the page cannot answer it) --> chatProtection.turnOff --> store.conform (plain)

every write (save, restore, conversion):  store --> writeMode() --> { form: 'plain' | 'encrypted' } or { refused: <sentence> }   (chatProtection.ts alone decides)
```

A chat's file keeps its name, `<id>.json`. Plain, it holds the JSON of D-016; sealed, it holds an envelope that the operating system's secure storage made of that same text (D-035), so
the title, the dates and the messages are not readable in it. Reading takes either, so a folder with both (a conversion that was cut short) is fine. **One module decides how a chat may be
written** (`chatProtection.ts`), and the store asks it before every write: with the choice off it says plain; with it on and the key usable, encrypted; and **when the key cannot be used,
when the secure storage is missing while the choice is on, or when the choice's own file cannot be read, it refuses, and nothing is written** (no fall-back to plain, and no encrypting under
a key that cannot be the one the saved chats were made with). The key's state is known from a _check_ written when the choice was made: a short text the secure storage encrypted, opened
again before every write. A sealed file that cannot be opened is left exactly as it is and counted; it is never deleted and never written over. `chatFile.ts`, `chatProtection.ts` and
`chatEncryptionService.ts` have no Electron imports (the secure storage and the system's dialogs are handed in), so the plain-Node suite plays a secure storage that can lose its key; the window
suite uses this PC's real one, and loses its key by deleting the profile's `Local State`.

### Sending a message

```
page                                 preload               main process                                     network
Composer -> useChat.send
  -> ipcReply(history, signal)
     toWireMessages (history.ts) ---> chat.start(request) -> chat.ts: sender guard, checkChatRequest,
                                                               read the key (keyStore) ->  adapter.stream()
                                                               (providers/anthropic.ts: SDK, pin key + address) ------> api.anthropic.com
     text pieces  <---------------- onEvent(listener) <---- sender.send('chat:event', ...)  <--- stream
  -> useChat: bubble grows; done / stopped / error note
```

Stop, reloading the window and closing it all abort the network request in main. The reply comes back as
six kinds of event: `start` (always first: which provider and model answer, sent before the key is looked up, so even a reply
that fails at once says which model was asked, D-021), `confirm` (only for a very large request: it has NOT been sent, and main waits for the person's yes, D-032), `text`, `usage` (what the reply used and cost, only when something is owed, just before
the last event, D-030), `done` and `error` (see `src/shared/ipc.ts`). The page keeps what `start`
says on the reply, and the list shows the model's name above a reply when it is the first one or the model changed. When a reply
has finished, main logs once what it used (provider/model and the four token counts). What the model is told about
earlier turns is D-013.

### Usage and cost

```
chat.ts (main)                                             usage/ledger.jsonl
  key found, request built
  ledger.begin(chat, model, effort, prices, input guess) -> line 1: state "sent", an estimate      (awaited: if it cannot be written, nothing is sent)
  adapter.stream()  ...text arrives (its bytes are counted)...
  the provider's report (four buckets)?
      yes -> ledger.finish(done, the report)             -> line 2, same id: replaces line 1 when the file is read
      no  -> ledger.finish(stopped | failed, a guess)    -> line 2: input as sent + output from the text that arrived, marked "estimate"
      a refusal before any work (key, credit, rate, model) -> line 2: "rejected", nothing owed
  send(usage event) -> page: the line under the reply
```

### Spending limits

```
chat.ts (main), for EVERY request: a new message, Regenerate / Try again, an edited message, or a call made straight through the bridge
  limitsStore.read()                 -> limits.json: daily + monthly, each an amount or "No limit"; a missing or damaged file is "not chosen"
  ledger.begin(request, check)       -> in the ledger's own turn: today's and this month's spending (requests on their way included)
                                        + this request's input at list price  ->  checkAgainstLimits(limits, spend)
       a sentence -> RequestRefused: nothing is written, nothing is sent, the page gets the sentence as the reply's error
       null       -> the line is written (as in 8.1) and the request goes out
```

Both limits must be chosen before anything is sent: the page asks for them in a dialog before the first message (it can be put off, and main
refuses meanwhile). The page can only choose (`settings.setLimits`, checked again in main); it cannot take a choice back, read the file or touch the ledger.
A reply that starts under a limit can end over it, by at most what one reply can write (D-031). Deleting the ledger resets the count, and Settings says so.

### The question before a very large request

```
chat.ts (main), for EVERY request, after the key is found and the request is built
  inputTokens = estimateInputTokens(...)            ONE guess, used for the question, for the limit's check and for the ledger's first line
  estimate = estimateRequest(inputTokens, streamRequest.maxOutputTokens, the model's prices)
  askFirstStore.read()                -> ask-first.json: an amount, "Never ask", or nothing chosen (then $0.50); damage = nothing chosen, never "Never ask"
  needsConfirmation(...)?             what the request SENDS could cost MORE than that amount (the input, not the reply)
     no  -> straight on
     yes -> a look at the limits and the sums: a request they would refuse anyway is refused now, with their sentence, and NOT asked about
            confirmations.ask(key, signal, show)   show = send({ type: 'confirm', model, estimate, askAboveUsd }) to the page, AFTER the question is waiting
                  page: LargeRequestDialog  -- Send --> window.api.chat.confirm(streamId) --> chat:confirm --> confirmations.send(key)
                                            -- Don't send / Escape --> chat.cancel(streamId) --> the reply ends "Not sent" on the page
            no yes (a no, a Stop, a reload, a closed window) -> runReply returns: nothing was written, nothing was sent
  limitsStore.read() AGAIN, then ledger.begin(request, check)   the limit's check of 8.2, in the ledger's own turn, exactly as before
  adapter.stream()
```

The question comes before the limit's check, never instead of it: a yes only lets the request go on to `ledger.begin`, which refuses it if a limit says so. Nothing is
begun in the ledger while the question is open, so a request that is never answered counts nothing. A yes means something only for a question that is waiting: one sent
ahead of it, twice, or for another stream is dropped, and a request cannot carry a field that approves it (`checkChatRequest` builds its own copy). The page works out no
figure of its own: the amounts it shows are main's. The page can choose the amount (`settings.setAskFirst`, checked again in main); it cannot read the file.

The page asks `usage.summary(conversationId | null)` and gets this chat's sum, today's and this month's, worked out by main from the
records in memory (read from the file once, at the first request or the first question). It cannot write the ledger, choose an id, a price or a token
count, or learn the file's path. The ledger holds model names, token counts, times and chat ids: no message text and no key. See D-030 for the
rule for a guess, which failures count, and what is not counted.

### Instructions for a chat

```
chat bar: Instructions (on) --InstructionsDialog (a draft until Save)--> useChat.instructions  (one text per conversation, '' for none)
                                                                          |                \
   every request: ipcReply --chat.start({ streamId, messages, instructions? })           useHistory: saved with the chat (version 3)
        main: checkChatRequest (text, trimmed, at most 8,000 characters, left out when blank)
              --> buildStreamRequest --> system = the app's rules + (if any) a line saying whose words follow + the instructions
              --> the adapter sends `system` (Anthropic) or `instructions` (OpenAI), as it always did with the prompt
```

The instructions are the person's, set only by pressing Save in the dialog, kept with the conversation, and sent with every request of that chat to
whichever provider answers (the dialog says so). They are added AFTER the app's own rules and never replace them: the page has no field that
sets the system prompt, and a field called `system` in a request is dropped by `checkChatRequest`. A chat without instructions sends exactly the
prompt it sent before Stage 7.4 (checked byte for byte against the recorded requests). A new chat starts without instructions; a chat opened
from History brings its own back. The Instructions button (in the chat bar under the message box since 7.6) says "on" while they are set, and is
off while a reply arrives, like the model and the effort. Asking again (Regenerate, an edited message) uses the instructions the chat has at that moment. See DECISIONS.md D-027.

## Chat UI (`src/renderer/src/chat/`)

| File                 | Job                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ChatView.tsx`       | Puts the message list and the input box together. The conversation itself is held in `App`, which also feeds the header's model menu |
| `ChatBar.tsx`        | (7) The slim row under the message box: New chat, History and Instructions, with the rules they had in the header (D-029)            |
| `useChat.ts`         | Conversation state and the cycle: send, reply streams in, then done / stopped / error. (4) `load`. (7) Instructions (D-027)          |
| `ipcReply.ts`        | The reply function: sends the conversation (and the instructions, if any) to main over the bridge and streams the answer             |
| `history.ts`         | Decides what the model is told about earlier turns (D-013)                                                                           |
| `types.ts`           | `ChatMessage`, `MessageStatus` and `ReplyFn`                                                                                         |
| `MessageList.tsx`    | Scrolling list. Stays on the newest text unless the reader scrolled up                                                               |
| `MessageBubble.tsx`  | One message: typing dots while waiting, a "Stopped" or error line when needed. (7) A reply is Markdown (D-025)                       |
| `MessageActions.tsx` | (7) Copy, Regenerate (Try again) and Edit under a message; the last two wait for a reply that is arriving (D-026)                    |
| `MessageEdit.tsx`    | (7) A message of the person's open for editing in place; asks first when more than the last exchange would go (D-026)                |
| `rewrite.ts`         | (7) What is sent again: the conversation without its last reply, or up to an edited message (plain functions)                        |
| `Composer.tsx`       | Input box. Enter sends, Shift+Enter adds a line. Shows Send, or Stop while a reply streams                                           |

`src/renderer/src/useCopy.ts` is the one place that writes the clipboard (on a click, D-025, D-026).

`App.tsx` adds the header (the Task, model and Effort menus, the badges, Settings: one row from 720 px up, whatever is showing, D-029) and the chat bar
under the message box (New chat, History, Instructions). All styling is one stylesheet,
`assets/main.css`, with colours as CSS variables at the top. The UI is dark only.

```
Composer --onSend--> useChat.send --> reply(history, signal) --text pieces--> messages --> MessageList
                                        ^ ipcReply: asks the main process, which asks the model
```

### The reply seam

`ReplyFn` is `(history, signal, onAnswerer, instructions) => AsyncIterable<string>`: the conversation so far, an
`AbortSignal`, a callback that is told which model answers, and the chat's instructions ('' for none) go in, and the reply comes out as a
stream of text pieces. `useChat` accepts any
`ReplyFn` (`App` passes `ipcReply`). Real providers also stream and can be cancelled, so they fit this
shape. The function behind it lives in the main process, reached over IPC; `useChat` and the components did
not have to change. See DECISIONS.md D-008.

`ChatMessage` (with its status) stays in the renderer: main does not need it. What main needs for chat
(plain role-and-text messages and the reply events) is in `src/shared/ipc.ts`, which both
`tsconfig.node.json` and `tsconfig.web.json` include.

## Build tooling

- `electron-vite` builds all three targets. Output goes to `out/` (git-ignored).
- `npm run dev` runs the app with hot reload. `npm run build` type-checks and builds.
  `npm run start` builds, then runs the production build from `out/`.
- Config lives in `electron.vite.config.ts`; TypeScript is split into `tsconfig.node.json`
  (main and preload) and `tsconfig.web.json` (renderer).
- The app runs on Electron 44 (D-003). electron-vite 5.0.0 only knows Electron up to 39 and would
  silently build for Node 16 / Chrome 108, so `electron.vite.config.ts` sets the build targets by
  hand. Update them whenever Electron is upgraded; the comment there says how to read the real values.
- Electron 42+ does not download its program during `npm install`. `postinstall` runs
  `install-electron` (about 150 MB the first time, cached afterwards) and then
  `electron-builder install-app-deps`. Only a plain `npm install` runs `postinstall`; adding package
  names to the command skips it. Run `npm run postinstall` if `npm run dev` says "Electron uninstall".

## Registry

`registry/` holds plain JSON data about models (D-005, D-014).

- `registry/models.json` - the models the app offers. **In use since Stage 3.** Envelope: `schemaVersion` ("0.4"),
  `updatedAt` and `source` (when and where the facts and prices were checked), `defaultModelId` and `models`. Each model:
  `provider`, `id`, `label`, `description`, `contextWindow`, `maxOutputTokens`, `pricing` (US dollars per million
  tokens: `inputPerMTok`, `cacheReadPerMTok`, `cacheWritePerMTok` and `outputPerMTok`, since 8.1), `capabilities` (facts: `imageInput`, `toolUse`, `reasoning`,
  `promptCaching`, and `effortLevels`, the effort levels its API accepts) and `effort` (the level the app asks for: one
  of the model's own `effortLevels`, or `null` for a model that takes none, as Haiku 4.5 did until D-036 removed it). Every object must have
  exactly these fields, and `effort` and `effortLevels` must agree (D-019). Ids are unique across providers.
- `registry/rankings.json` - which models the providers' own pages name for which task (D-023). Schema 0.2: `updatedAt`,
  `source` and `rankings`, a list of rows `{ task, modelId, note, source, asOf }` with `task` one of chat, coding, writing, quick.
  A row is a quoted statement with its address and date, not a score. The file is embedded in the build and checked once at startup by
  `parseRankings` (`src/shared/rankings.ts`); a broken row is left out, a broken file costs only the suggestions. `suggestionsFor` turns the
  rows into what the page is shown: the rows for models in the registry whose provider has a key (a model that has left the registry is
  skipped). The Task menu and the "(suggested)" marks in the model menu use it; nothing is ever chosen from it.

`models.json` is **embedded in the app at build time** (a JSON import in `src/main/registry.ts`), so there is no
file to find at run time, and it is checked once at startup by `parseRegistry` (`src/shared/registry.ts`). Edit it,
then restart `npm run dev` (or run `npm run dev -- --watch`, which rebuilds and restarts by itself).

- A file that is not valid JSON stops the build, with the file and position.
- An entry with a typo is left out and named in the app's log; the other models keep working.
- A file that cannot be used as a whole (wrong `schemaVersion`, no usable entry, a `defaultModelId` that is not
  usable) shows "Models unavailable"; replies explain why and no request is made. There is no built-in fallback list.
- The file holds no addresses and no credentials, and a `provider` the code cannot call is left out: the API
  address and the key's destination stay in the adapter (`src/main/providers/anthropic.ts`).

## Security notes

- No API keys or `.env` files in the repo. The key is stored per user, outside git (D-010): encrypted by
  the operating system, and never sent to the page. It protects against a copy of the file on another
  computer or account. It does not protect against a program running as you on this computer, which
  can ask the same secure storage to decrypt it.
- Do not save files in the data folder by writing a temp file and renaming it over the real one. On
  this project's own PC, which has Windows EFS encryption on `%APPDATA%`, every rename there fails
  with EXDEV. Write in place (or copy then delete) and read the result back. Test storage code in an
  EFS-encrypted folder, not only in `%TEMP%`.
- The registry cannot redirect the key: it holds no address or credential, only facts about models and one
  request setting per model, and a provider the code cannot call is left out (D-014). The model choice is saved in
  `preferences.json`, apart from the key file, written in place like it (D-010, D-015). The page can only choose a
  model that is on offer, and main checks that twice. The effort level is kept there too, per model, and is checked against the registry
  three times (D-024).
- The key is sent only to `https://api.anthropic.com`, and only by `src/main/providers/anthropic.ts`. The SDK's
  environment fallbacks (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`) are switched off on purpose (D-012).
  `FRONTIER_API_BASE_URL` redirects it for testing, but only when running from source.
- Every message handler in main (`src/main/ipc.ts`, `src/main/chat.ts`) runs through a guard: only a call from the window's
  top frame, on the app's own page, is answered. The preload API also exists in an `about:blank` page,
  so the guard does not just trust "it came from our window". It then validates the input again.
- The window is sandboxed, context-isolated and has no Node.js (D-004). A sandboxed preload may only
  require `electron`, `events`, `timers` and `url`: no npm packages, no other files at run time (the
  build tool bundles files the preload imports). If it breaks that rule the preload fails to load and
  the page silently gets no `window.api`; check the console for "Unable to load preload script".
- The usage ledger (D-030) is written by the main process alone, in the data folder, as plain text: the page can ask for sums and nothing else, and
  cannot name an id, a price or a token count for a record. A request that cannot be recorded is not sent. It is a plain file the owner can read, and
  can edit or delete: the limit of Stage 8.2 stops the app, not a person who changes the file.
- The spending limits (D-031) are chosen by the person and enforced by the main process, in the one place a provider is called: before every request, in
  the ledger's own turn, so two requests cannot both pass on the same money. Nothing is sent until both limits are chosen. A `limits.json` that is missing,
  damaged or cut off means "not chosen", never "No limit"; one that cannot be read at all refuses requests. The page can choose limits and cannot take a choice back.
- The question before a very large request (D-032) is asked by the main process, in the same place, and holds the request until the person says yes: nothing is written
  to the ledger and nothing is sent while it waits. It guards the person against their own slip and a bug in the page; it is not a defence against a hostile page, which can
  answer its own question. The limits above stop a slip, a bug and a model's words, and a hostile page could also change them (`settings.setLimits` needs no answer from the person: D-033),
  so they are not a defence against one either: what keeps hostile code out of the page is the window's own guards. A yes is heard only for a question that is waiting (not ahead of it, not twice, not for another stream), and the
  request carries no field that approves it. A damaged or unreadable `ask-first.json` means the default amount, so the question is still asked; it never means "Never ask".
- Saved conversations are plain text on disk until the person turns encryption on (D-016, D-035; "Saved chats" in Settings), after which each file is sealed by the operating
  system's secure storage like the key: a copy of the files taken to another computer or account cannot be read. The History dialog says which it is and names the folder.
  What this does not give is listed in D-035 (a program running as the person; a backup; the places on disk where old plain text may linger). When the key cannot be used,
  nothing is saved and nothing is changed (D-035). The id of a conversation becomes part of a file name, so it is checked twice (in
  `ipc.ts` and inside the store) against the one spelling the app makes; the title and dates are never the
  page's; a file's size is looked at before it is read; and nothing deletes a file but the person's own Delete.
  The four `history:` handlers run through the same sender guard as the rest.
- A backup of chats (D-034) goes where the person chooses in the system's own dialog, never where the page says: the page sends "all" or "one chat" and receives
  the place only afterwards. A backup is refused inside the app's data folder (links followed), so it cannot land on a key or a setting. The file is read back before
  it counts. A restore adds and never replaces, only after a look the person has seen, with a one-use token for the file that was looked at. **A backup from someone else
  is untrusted**: the checksum guards against damage and not against a person who rewrites it, and the model takes a chat's history as true when it is continued.
- The page gets only what `src/preload/index.ts` lists under `window.api`. Never expose Electron's
  whole `ipcRenderer`: any script in the page could then call any channel.
- The window cannot navigate away from the app's own page, and only https links (without a user name or
  password) reach the operating system (`src/main/security.ts`; plain http was passed before Stage 7.2).
  `about:blank` is the one navigation this cannot stop, and that page still gets `window.api`, so every IPC
  handler must also check who is calling.
- What the person types is shown as typed, as text. A reply is drawn as Markdown by `src/renderer/src/markdown/`
  (D-025): the reader makes a tree of a few known kinds, never HTML, and the page makes elements from a closed set
  (no `dangerouslySetInnerHTML`, no `style`, `href`, `src` or handler of a reply's making). Raw HTML and images in a
  reply are shown as the text they were written as and nothing is loaded. A link in a reply is a button that asks
  first; only Open hands an https address to the browser.
- The person's instructions for a chat (D-027) are text they wrote and saved in the dialog, and nothing else can set them: a reply is never
  read for them, and the page cannot send a system prompt (a `system` field is dropped; only `instructions` is read, and main checks it
  again). They are added after the app's own rules, never in place of them. They are sent with every request to whichever provider answers and
  saved as plain text in the chat's file, and the dialog says both. A chat file opened from History brings its instructions with it, and the
  "on" mark on the Instructions button shows that they are there; a file whose instructions are not usable is left alone.

## Not built yet

Renaming or searching saved chats, a progress line for a long restore or conversion, a check against the real API (Stages 2 to 4 were tested
against a mock, which covers four models), a single suggested model per task (D-023 says why not), other providers. See
ROADMAP.md.
