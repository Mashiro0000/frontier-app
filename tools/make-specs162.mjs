// Writes the negative-control specs for slice 16.2 (the rules of image generation, D-048): one sabotage each, which verify-16-2.mjs must notice.
// usage: node tools/make-specs162.mjs
//   then: FRONTIER_MAY_REMOVE=1 FRONTIER_KEEP_TEMP=1 TEMP=C:\frontier-tmp TMP=C:\frontier-tmp node tools/nc-all.mjs specs162 <names...>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOOLS } from './paths.mjs'

const I = '{{REPO}}/src/shared/images.ts'
const U = '{{REPO}}/src/shared/usage.ts'
const L = '{{REPO}}/src/main/usageLedger.ts'
const K = '{{REPO}}/src/main/imageCheck.ts'
const X = '{{REPO}}/src/main/imageIndex.ts'
const S = '{{REPO}}/src/main/imageSettings.ts'

// name: [ONLY, file, from, to]
const controls = {
  iTopKeys: ['A', I, "  if (!keysAre(raw, 'defaultModelId,models,schemaVersion,source,updatedAt')) {", '  if (false) {'],
  iSchema: ['A', I, "if (raw.schemaVersion !== '1') return fail", 'if (false) return fail'],
  iModelKeys: ['A', I, "if (!keysAre(raw, 'description,id,label,perPicture,prices,published,retires')) {", 'if (false) {'],
  iPrefix: ['A', I, 'if (!isModelId(id) || !/^gpt-image-/.test(id))', 'if (!isModelId(id))'],
  iTwice: ['A', I, '    if (models.some((there) => there.id === model.id))\n      return fail', '    if (false)\n      return fail'],
  iMonotonic: ['A', I, '      (row.medium as number) <= (row.high as number)', '      true'],
  iTableKeys: ['A', I, "if (!isPlain(row) || !keysAre(row, 'high,low,medium')) return null", 'if (!isPlain(row)) return null'],
  iPriceMax: ['A', I, 'if (!isPrice(row[quality], 5)) return null', 'if (!isPrice(row[quality], 50)) return null'],
  iDescriptionLength: ['A', I, 'if (!isLine(description, 300))', 'if (!isLine(description, 3000))'],
  iDefaultFallback: ['A', I, 'const fallback = models.find((model) => model.retires === null) ?? models[0]', 'const fallback = models[models.length - 1]'],
  iRetiredDay: ['B', I, "  if (left <= 0) return 'retired'", "  if (left < 0) return 'retired'"],
  iWarnDays: ['B', I, "return left <= IMAGE_LIMITS.retireWarnDays ? 'retiring' : 'ok'", "return left < IMAGE_LIMITS.retireWarnDays ? 'retiring' : 'ok'"],
  iRetiredAsk: ['B', I, "  if (retirement(entry, now) === 'retired') {", '  if (false) {'],
  iAbout: ['C', I, 'about: !model.published }', 'about: false }'],
  iTimesCount: ['C', I, 'usd: model.perPicture[shape][quality] * count,', 'usd: model.perPicture[shape][quality],'],
  iTokenPrice: ['C', I, 'tokens.output * model.prices.imageOutPerMTok', 'tokens.output * model.prices.textInPerMTok'],
  iAskKeys: ['C', I, "!keysAre(input, 'chat,count,model,prompt,quality,shape')", 'false'],
  iPromptMax: ['C', I, "if (value.trim() === '' || value.length > IMAGE_LIMITS.maxPromptChars) return false", "if (value.trim() === '') return false"],
  iCountMax: ['C', I, '(count as number) > IMAGE_LIMITS.maxCount', '(count as number) > 10'],
  iChat: ['C', I, 'if (chat !== null && !isConversationId(chat)) return refuse', 'if (false) return refuse'],
  iPortrait: ['C', I, "portrait: '1024x1536',", "portrait: '1024x1792',"],
  iQuality: ['C', I, 'if (!isShape(shape) || !isQuality(quality))', 'if (!isShape(shape))'],
  uImageKeys: ['D', U, "      Object.keys(image).sort().join() !== 'count,kind,usd' ||\n", ''],
  uImageMax: ['D', U, '(image.usd as number) > 100', '(image.usd as number) > 1e9'],
  uImageCount: ['D', U, '      (image.count as number) > 10 ||\n', ''],
  uCost: ['D', U, '(record.image === undefined ? 0 : record.image.usd)', '0'],
  uDropped: ['D', U, '...(pictureFee === undefined ? {} : { image: pictureFee })', '...{}'],
  lBegin: ['D', L, '...(input.image === undefined ? {} : { image: { ...input.image } })', '...{}'],
  lFinish: ['D', L, '...(outcome.image === undefined ? {} : { image: { ...outcome.image } })', '...{}'],
  kCount: ['E', K, '  if (data.length !== count) {', '  if (data.length < count) {'],
  kUrl: ['E', K, " || item.url !== undefined) {", ') {'],
  kMaxBytes: ['E', K, '  if (bytes.length > IMAGE_LIMITS.maxPictureBytes) {', '  if (bytes.length > 64 * 1024 * 1024) {'],
  kTypes: ['E', K, "const KEPT_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']", "const KEPT_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']"],
  kEdge: ['E', K, 'if (header.width > IMAGE_LIMITS.maxEdge || header.height > IMAGE_LIMITS.maxEdge) {', 'if (header.width > 8000 || header.height > 8000) {'],
  kAnimated: ['E', K, "  if (header.animated) return { ok: false, why: 'it is animated' }\n", ''],
  kCanonical: ['E', K, "    if (bytes.toString('base64') !== text) return { ok: false, why: 'a picture is not base64' }\n", ''],
  kEarlySize: ['E', K, '    if (text.length > MAX_BASE64_CHARS + 4) {', '    if (false) {'],
  xRecordKeys: ['F', X, '  if (Object.keys(r).sort().join() !== RECORD_KEYS) return null\n', ''],
  xIdTwice: ['F', X, '    if (record === null || ids.has(record.id)) return null', '    if (record === null) return null'],
  xGalleryMax: ['F', X, 'file.pictures.length > IMAGE_LIMITS.galleryMax) return null', 'file.pictures.length > 100000) return null'],
  xTypes: ['F', X, "const TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp']", "const TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']"],
  xChat: ['F', X, '  if (r.chat !== null && !isConversationId(r.chat)) return null\n', ''],
  sKeys: ['G', S, "    Object.keys(fields).sort().join() !== 'on,version' ||\n", ''],
  sBoolean: ['G', S, "  if (typeof fields.on !== 'boolean') return null\n  return Object.freeze({ on: fields.on })", '  return Object.freeze({ on: fields.on === true || fields.on === "yes" })']
}

mkdirSync(join(TOOLS, 'specs162'), { recursive: true })
for (const [name, [only, file, from, to]] of Object.entries(controls)) {
  if (typeof file !== 'string' || typeof from !== 'string' || typeof to !== 'string' || /\$[$&`'0-9<]/.test(to)) throw new Error(`the control ${name} is not well formed`)
  const spec = { label: `n162-${name}`, edits: [{ file, from, to }], argv: ['{{TOOLS}}/guarded.mjs', '{{TOOLS}}/verify-16-2.mjs'], env: { ONLY: only }, timeoutMs: 300000 }
  writeFileSync(join(TOOLS, 'specs162', `n162-${name}.json`), JSON.stringify(spec, null, 2) + '\n')
}
console.log(`wrote ${Object.keys(controls).length} specs in specs162`)
