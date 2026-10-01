/** When a conversation was last saved, as the person's own language and clock write it: "Oct 1, 2026, 2:03 PM". */
export function formatWhen(time: number): string {
  return new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** "1 message" or "12 messages". */
export function formatCount(count: number): string {
  return `${count} ${count === 1 ? 'message' : 'messages'}`
}
