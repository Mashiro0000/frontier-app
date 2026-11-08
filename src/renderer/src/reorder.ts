import type React from 'react'

// (23.8, D-055) What makes a row of a list the person may reorder: drag it with the mouse onto another row, or, on its button, Alt+Up / Alt+Down. After
// a move by keys the keyboard stays on the moved row (found again by its data-reorder-id, since the list is drawn anew).

const DRAG_TYPE = 'application/x-frontier-reorder'

export function reorderable(
  list: string,
  id: string,
  index: number,
  count: number,
  onMove: (id: string, to: number) => void
): {
  draggable: true
  'data-reorder-id': string
  onDragStart: React.DragEventHandler
  onDragOver: React.DragEventHandler
  onDrop: React.DragEventHandler
  onKeyDown: React.KeyboardEventHandler
} {
  return {
    draggable: true,
    'data-reorder-id': `${list}:${id}`,
    onDragStart: (event) => {
      event.dataTransfer.setData(DRAG_TYPE, `${list}:${id}`)
      event.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (event) => {
      if (event.dataTransfer.types.includes(DRAG_TYPE)) event.preventDefault() // a drop of this list's rows only
    },
    onDrop: (event) => {
      const [from, moved] = event.dataTransfer.getData(DRAG_TYPE).split(/:(.*)/s)
      if (from !== list || moved === undefined || moved === id) return
      event.preventDefault()
      onMove(moved, index)
    },
    onKeyDown: (event) => {
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
      event.preventDefault()
      const to = index + (event.key === 'ArrowUp' ? -1 : 1)
      if (to < 0 || to >= count) return
      onMove(id, to)
      requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(
          `[data-reorder-id="${CSS.escape(`${list}:${id}`)}"]`
        )
        ;(row?.matches('button') ? row : row?.querySelector<HTMLElement>('button'))?.focus()
      })
    }
  }
}

/** The words that say how a row can be moved, for its tooltip. */
export const MOVE_HINT = 'Drag to move it, or Alt+Up / Alt+Down.'
