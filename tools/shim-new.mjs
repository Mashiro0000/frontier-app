// Test harness only (lives outside the project on purpose).
// Gives the NEW provider layer (src/main/providers/*) the shape of the OLD src/main/provider.ts, so that the old
// suites and the golden capture can run against it UNCHANGED:
//   streamReply({ apiKey, baseURL, model, messages, signal, onText }) -> Promise<ReplyEnd>
//   describeError(error, apiKey, modelId)                              -> string
//   mergeAdjacent(messages)                                            -> messages
//   API_BASE_URL
// Everything of substance is the product's own code (buildStreamRequest, the adapter, describeFailure): this file only
// wires them together the way chat.ts does.
import { REPO_URL } from './paths.mjs'
import './ts-resolve.mjs'

const base = `${REPO_URL}/src/main/providers/`
const { buildStreamRequest, mergeAdjacent } = await import(base + 'request.ts')
const { adapterFor } = await import(base + 'index.ts')
const { describeFailure } = await import(base + 'errors.ts')
const { API_BASE_URL } = await import(base + 'anthropic.ts')

export { mergeAdjacent, API_BASE_URL }

export async function streamReply({ apiKey, baseURL, model, messages, signal, onText }) {
  const adapter = adapterFor(model.provider)
  const request = buildStreamRequest({ credentials: { apiKey, baseURL }, model, messages, signal })
  let end = null
  for await (const event of adapter.stream(request)) {
    if (event.type === 'text') onText(event.text)
    else end = event.end
  }
  if (end === null) throw new Error('the adapter ended the stream without an end event')
  return end
}

export function describeError(error, apiKey, modelId) {
  return describeFailure(adapterFor('anthropic').normalizeError(error, { modelId }), apiKey)
}
