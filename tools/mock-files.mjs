// Files in a request, as the two mock providers see them (Stage 9.3, D-037): what each provider's documentation says it takes, checked the way it says it
// refuses, and a description of what arrived for the [[mock:files]] reply. My reading of the documentation (Anthropic: "Vision", "PDF support"; OpenAI:
// "Images and vision", "File inputs"), not the real APIs. Test tooling only.

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** The size in pixels of a PNG, JPEG, GIF or WebP, from its header (enough for the "many images" rule); null if it cannot be read. */
export function imageSize(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.length > 10 && bytes.subarray(0, 3).toString('latin1') === 'GIF') return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (bytes.length > 30 && bytes.subarray(8, 12).toString('latin1') === 'WEBP') {
    const fourcc = bytes.subarray(12, 16).toString('latin1')
    if (fourcc === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 }
    if (fourcc === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    if (fourcc === 'VP8L') { const b = bytes.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 } }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let at = 2; at + 9 < bytes.length; ) {
      if (bytes[at] !== 0xff) return null
      const marker = bytes[at + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) }
      at += 2 + bytes.readUInt16BE(at + 2)
    }
  }
  return null
}

const typeOfBytes = (bytes) =>
  bytes.readUInt32BE(0) === 0x89504e47 ? 'image/png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
      : bytes.subarray(0, 3).toString('latin1') === 'GIF' ? 'image/gif'
        : bytes.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp'
          : bytes.subarray(0, 5).toString('latin1') === '%PDF-' ? 'application/pdf' : null

/** Anthropic: the problems with the content blocks of one message (an empty list when it is fine). Images are collected into `images`. */
export function anthropicBlockProblems(message, i, images) {
  const problems = []
  if (!Array.isArray(message.content)) return problems
  if (message.content.length === 0) problems.push(`messages.${i}.content: at least one content block is required`)
  message.content.forEach((block, j) => {
    const where = `messages.${i}.content.${j}`
    if (block?.type === 'text') {
      if (typeof block.text !== 'string' || block.text === '') problems.push(`${where}: text content blocks must be non-empty`)
      return
    }
    if (message.role !== 'user') { problems.push(`${where}: ${block?.type} blocks are only allowed in user messages`); return }
    if (block?.type === 'image') {
      const s = block.source
      if (s?.type !== 'base64' || !IMAGE_TYPES.includes(s.media_type) || typeof s.data !== 'string' || s.data === '' || !BASE64.test(s.data)) { problems.push(`${where}.source: an image must be base64 of image/jpeg, image/png, image/gif or image/webp`); return }
      if (s.data.length > 10 * 1024 * 1024) problems.push(`${where}.source.data: image exceeds 10 MB maximum`)
      const bytes = Buffer.from(s.data, 'base64')
      if (typeOfBytes(bytes) !== s.media_type) problems.push(`${where}.source: Image does not match the provided media type ${s.media_type}`)
      const size = imageSize(bytes)
      if (size === null) problems.push(`${where}.source: Could not process image`)
      else {
        if (size.width > 8000 || size.height > 8000) problems.push(`${where}: image dimensions exceed max allowed size: 8000 pixels`)
        images.push(size)
      }
      return
    }
    if (block?.type === 'document') {
      const s = block.source
      if (block.title !== undefined && (typeof block.title !== 'string' || block.title === '')) problems.push(`${where}.title: must be a non-empty string`)
      if (s?.type === 'base64') {
        if (s.media_type !== 'application/pdf' || typeof s.data !== 'string' || !BASE64.test(s.data) || s.data === '') problems.push(`${where}.source: a base64 document must be application/pdf`)
        else if (typeOfBytes(Buffer.from(s.data.slice(0, 16), 'base64')) !== 'application/pdf') problems.push(`${where}.source: The PDF specified was not valid`)
        return
      }
      if (s?.type === 'text') {
        if (s.media_type !== 'text/plain' || typeof s.data !== 'string') problems.push(`${where}.source: a text document must be text/plain`)
        return
      }
      problems.push(`${where}.source.type: must be base64, text, content or url`)
      return
    }
    problems.push(`${where}.type: unknown content block type ${block?.type}`)
  })
  return problems
}

/** Anthropic: the rule for many images (over 20 in one request, each at most 2000 px a side). */
export function anthropicManyImages(images) {
  return images.length > 20 && images.some((s) => s.width > 2000 || s.height > 2000) ? ['At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels'] : []
}

/** What the last user message of an Anthropic request carried, for the [[mock:files]] reply: one part per block, in order. */
export function describeAnthropic(body) {
  const m = [...(body.messages ?? [])].reverse().find((x) => x.role === 'user')
  if (!Array.isArray(m?.content)) return 'Files: none'
  const parts = m.content.map((b) => {
    if (b.type === 'image') { const bytes = Buffer.from(b.source.data, 'base64'); const s = imageSize(bytes); return `image ${b.source.media_type} ${s ? `${s.width}x${s.height}` : '?'} ${bytes.length} bytes` }
    if (b.type === 'document' && b.source.type === 'base64') return `pdf "${b.title ?? ''}" ${Buffer.from(b.source.data, 'base64').length} bytes`
    if (b.type === 'document' && b.source.type === 'text') return `text "${b.title ?? ''}" ${b.source.data.length} chars`
    return `words ${b.text.length} chars`
  })
  return `Files: ${parts.join(' | ')}`
}

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/

/** OpenAI: the problems with the content parts of one input item. */
export function openaiPartProblems(item, i) {
  const problems = []
  if (!Array.isArray(item.content)) return { problems, bytes: 0 }
  let bytes = 0
  if (item.content.length === 0) problems.push(`input[${i}].content: must not be empty`)
  item.content.forEach((part, j) => {
    const where = `input[${i}].content[${j}]`
    if (part?.type === 'input_text') { if (typeof part.text !== 'string' || part.text === '') problems.push(`${where}.text: must be non-empty`); return }
    if (item.role !== 'user') { problems.push(`${where}: ${part?.type} is only allowed in user input`); return }
    if (part?.type === 'input_image') {
      const m = typeof part.image_url === 'string' ? DATA_URL.exec(part.image_url) : null
      if (!m || !IMAGE_TYPES.includes(m[1])) { problems.push(`${where}.image_url: Invalid image URL`); return }
      if (!['auto', 'low', 'high', 'original'].includes(part.detail)) problems.push(`${where}.detail: must be one of auto, low, high, original`)
      const data = Buffer.from(m[2], 'base64')
      bytes += data.length
      if (typeOfBytes(data) !== m[1]) problems.push(`${where}: Invalid image data`)
      if (m[1] === 'image/gif' && data.includes(Buffer.from('NETSCAPE2.0'))) problems.push(`${where}: animated GIFs are not supported`)
      return
    }
    if (part?.type === 'input_file') {
      const m = typeof part.file_data === 'string' ? DATA_URL.exec(part.file_data) : null
      if (typeof part.filename !== 'string' || part.filename === '') problems.push(`${where}.filename: required with file_data`)
      if (!m || m[1] !== 'application/pdf') { problems.push(`${where}.file_data: expected a data URL of application/pdf`); return }
      const data = Buffer.from(m[2], 'base64')
      bytes += data.length
      if (typeOfBytes(data) !== 'application/pdf') problems.push(`${where}: Invalid file data`)
      return
    }
    problems.push(`${where}.type: Invalid value '${part?.type}'`)
  })
  return { problems, bytes }
}

/** What the last user input of an OpenAI request carried, for the [[mock:files]] reply. */
export function describeOpenAI(body) {
  const m = [...(body.input ?? [])].reverse().find((x) => x.role === 'user')
  if (!Array.isArray(m?.content)) return 'Files: none'
  const parts = m.content.map((p) => {
    if (p.type === 'input_image') { const [, type, data] = DATA_URL.exec(p.image_url); const bytes = Buffer.from(data, 'base64'); const s = imageSize(bytes); return `image ${type} ${s ? `${s.width}x${s.height}` : '?'} ${bytes.length} bytes` }
    if (p.type === 'input_file') return `pdf "${p.filename}" ${Buffer.from(DATA_URL.exec(p.file_data)[2], 'base64').length} bytes`
    return `words ${p.text.length} chars`
  })
  return `Files: ${parts.join(' | ')}`
}
