# frontier-app

An Electron application with React and TypeScript

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

The first install also downloads the Electron program itself (about 150 MB). Later installs reuse a
local cache.

### Development

```bash
$ npm run dev
```

The first time, click **Settings** and paste your own API key for the provider you want: Anthropic (Claude) or OpenAI
(GPT). There is one section per provider, each with **Save key**, **Test key** (a free call that asks the provider for its
models) and **Remove key**. A key is stored encrypted on your computer, and replies are billed to your account with that
provider. The default model is Claude Opus 5.5; the menu in the header chooses another (Claude Fable 5.1, Sonnet 5.5,
or OpenAI's GPT-6 Astra, GPT-6.1 Sol and GPT-6 Luna; Claude Haiku 4.5 was removed ahead of its retirement, D-036), and Settings shows what each one costs. A chat can move
between providers: the whole conversation is sent to whichever model answers next. The **Task** menu next to the model
menu (chat, coding, writing, quick answer) marks the models the providers' own pages name for a task with "(suggested)";
it chooses nothing, and the list is `registry/rankings.json` (D-023). The **Effort** menu (Faster to Smarter) says how hard the chosen model
thinks before it answers: it offers the levels the registry lists for that model, remembers your choice per model, and is not shown for a
model that takes none (none of the listed models since Haiku 4.5 was removed). A higher level is slower and billed as more output (D-024).
Replies are shown as Markdown (headings, lists, tables, quotes, code blocks with a **Copy** button) by a small reader of the app's
own; raw HTML and images in a reply are shown as text and nothing is loaded. A link in a reply asks first: you see the whole address,
and only **Open** sends it to your browser (D-025). What you type is shown as typed.
Under each message: **Copy** (the text as written); under the last reply **Regenerate** (**Try again** after a failure), which replaces it;
under your own messages **Edit**, which replaces the message and everything after it and asks again, asking first if more than the last
exchange would go. Asking again sends the whole conversation again and is billed again (D-026).
The **Instructions** button under the message box (next to **New chat** and **History**) opens a box for instructions of your own for the chat you are in (who the model should be, how long to
write, what to leave out). They are added to the app's own rules and sent with every message of that chat, to the company that runs the model
that answers, so they are billed and, like the chat, saved as plain text on your computer; do not put passwords in them. The button says "on"
while they are set, a new chat starts without them, and a chat opened from History brings its own back (D-027).
Every request is counted (Stage 8.1, D-030): under each finished reply a small line says what it used and cost ("25 in, 12 out, $0.0003"), and
**Settings > Usage** shows the sums for the chat you are in, for today and for this month. The numbers are the provider's own report, priced at list
prices (cached input at its own, lower price); when there is no report (a reply you stopped, a connection that dropped) the app guesses from the
text and marks it **about**. The record is a plain file, `usage/ledger.jsonl`, in the app's data folder, written by the app alone. Your provider's
invoice is what counts.
Spending is limited by you (Stage 8.2, D-031): nothing is sent until you have chosen a **daily and a monthly limit** (the app asks before your first message; there are
no preset amounts, and "No limit" is a choice you make on purpose). A request that would take today's or this month's spending past a limit is not sent, whatever
the page says: the main process checks every request, including Regenerate and Edit. **Settings > Spending limits** changes them. A reply that starts under a limit
can end a little over it, by at most that one reply. Before a **very large request** the app asks first (Stage 8.3, D-032): when sending the conversation so far
could cost more than an amount of yours (**Settings > Large requests**; $0.50 until you choose, or "Never ask"), it shows what the request could cost at the most,
input and reply, and sends nothing until you press **Send**; **Don't send** (or Escape) ends the reply as "Not sent", and **Try again** asks again.
The list of models is `registry/models.json`: edit it, then restart `npm run dev` (or run `npm run dev -- --watch`
so it restarts by itself). See docs/DECISIONS.md D-012, D-014, D-015, D-020 and D-022.

Chats are saved on your computer as you go, one plain file each, in a `conversations` folder next to the app's
other data (the History dialog shows the path). They are not encrypted unless you turn that on (**Settings > Saved chats**: it first asks where to
save a backup of your chats, checks it, and only then encrypts them with this computer's secure storage, the protection your API key has; if that
key is ever lost, encrypted chats cannot be opened, and the backup is how you get them back; D-035). **New chat** starts an
empty chat; **History** opens a saved one or deletes it, and backs chats up to a file or restores them from one (D-034). Each reply records which model wrote it (D-021), and the file holds the chat's
instructions (D-027; a chat saved by this version cannot be read by one from before Stage 7.4). See docs/DECISIONS.md D-016 and D-017.

Tools are off until you switch them on in **Tools**, and every call the model asks for is asked about in a Windows message box first (D-041): a web
search, files in one workspace folder (D-042), running a program in a locked box (D-043), and **connectors** (Stage 14, D-045): tools that another
program on this PC (run in the same locked box by default) or a web address offers through MCP. You add a connector in Tools, read each of its tools
and switch on the ones you want; nothing is installed or downloaded by the app. A web connector that wants a sign-in shows **Sign in** (Stage 14b, D-046): you sign in on the provider's page in your own browser, the app never sees your password, and it keeps a token sealed on this PC until you sign out.

### Checks

The app has no test framework (D-007). `tools/` holds the check scripts that drive the real window against a fake
provider API, with their negative controls: `node tools/regress.mjs <tag>`, see `tools/README.md`.

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
