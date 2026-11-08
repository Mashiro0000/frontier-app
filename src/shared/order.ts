// (23.8, D-055) Reordering a list the person keeps (the sidebar's pages, their experts, their projects): one item moved to a new place, everything else in
// the same order. Used by main for the kept files and by the page for the sidebar.

/** The list with the item `id` moved to index `to` (0 is first), or null when there is no such item or `to` is not a place in the list. */
export function moveTo<T extends { id: string }>(
  list: readonly T[],
  id: unknown,
  to: unknown
): T[] | null {
  const from = list.findIndex((item) => item.id === id)
  if (from === -1 || typeof to !== 'number' || !Number.isInteger(to) || to < 0 || to >= list.length)
    return null
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/**
 * A saved order of known ids made usable: unknown ids and repeats dropped, ids it lacks added at the end in their default order (a page added in a later
 * version appears, last). Anything that is not a list of strings gives the default.
 */
export function orderOf(saved: unknown, known: readonly string[]): string[] {
  const kept = Array.isArray(saved)
    ? saved.filter(
        (id, i): id is string =>
          typeof id === 'string' && known.includes(id) && saved.indexOf(id) === i
      )
    : []
  return [...kept, ...known.filter((id) => !kept.includes(id))]
}
