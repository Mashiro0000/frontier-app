// (23.1, D-055) The sidebar's chats in groups, as ChatGPT and AI Fiesta show them: the pinned ones first, then by the day they were last changed, in this
// computer's own time: Today, Yesterday, Previous 7 days, Previous 30 days, then one group per month ("October 2026"). The order inside a group is the
// list's own (newest first).

export interface ChatGroup<T> {
  label: string
  chats: T[]
}

const DAY = 24 * 60 * 60 * 1000

export function groupChats<T extends { updatedAt: number; pinned?: true }>(
  chats: readonly T[],
  now: number = Date.now()
): ChatGroup<T>[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const startOfToday = today.getTime()
  // Whole calendar days back from today's start (a day of 23 or 25 hours, at a clock change, still counts as one).
  const daysAgo = (time: number): number => {
    const day = new Date(time)
    day.setHours(0, 0, 0, 0)
    return Math.round((startOfToday - day.getTime()) / DAY)
  }
  const month = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
  const groups: ChatGroup<T>[] = []
  const add = (label: string, chat: T): void => {
    const group = groups.find((g) => g.label === label)
    if (group) group.chats.push(chat)
    else groups.push({ label, chats: [chat] })
  }
  for (const chat of chats) if (chat.pinned === true) add('Pinned', chat)
  for (const chat of chats) {
    if (chat.pinned === true) continue
    const days = daysAgo(chat.updatedAt)
    add(
      days <= 0
        ? 'Today'
        : days === 1
          ? 'Yesterday'
          : days <= 7
            ? 'Previous 7 days'
            : days <= 30
              ? 'Previous 30 days'
              : month.format(chat.updatedAt),
      chat
    )
  }
  return groups
}
