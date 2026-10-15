// A stand-in for the app in the Stage 14 probe (D-045): it starts ONE connector in the box and then waits, so that the probe can kill it like a crashed app and look
// whether the box went with it. Usage (env): FA_REPO_URL, FA_ROOT (the run root), FA_HOME, FA_DATA, FA_NODE (the installed node.exe), FA_CONTAINER.
await import(`${process.env.FA_REPO_URL}/tools/ts-resolve.mjs`)
const { createCommandRunner } = await import(`${process.env.FA_REPO_URL}/src/main/commandRunner.ts`)
const { connectMcp, createStdioWire } = await import(`${process.env.FA_REPO_URL}/src/main/mcpClient.ts`)
const runner = createCommandRunner({ runRoot: process.env.FA_ROOT })
const handle = await runner.serve({
  container: process.env.FA_CONTAINER,
  homeDir: process.env.FA_HOME,
  dataDir: process.env.FA_DATA,
  program: process.env.FA_NODE,
  args: ['<<HOME>>\\app\\ref-server.mjs', '--era', 'modern'],
  network: false
})
if (!('stdin' in handle)) {
  console.log('NOTRUN ' + JSON.stringify(handle))
  process.exit(1)
}
handle.stderr.resume()
const session = await connectMcp(createStdioWire(handle), { signal: AbortSignal.timeout(60000) })
const who = await session.callTool('whoami', {}, AbortSignal.timeout(30000))
const facts = JSON.parse(who.result.content[0].text)
console.log('SERVERPID ' + facts.pid)
setInterval(() => {}, 1000)
