import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  /** Called with pixel delta for the panel this handle controls. */
  onResize: (deltaX: number) => void
  onResizeEnd?: () => void
  /**
   * `end` — handle is on the right edge of a left panel (drag right → grow).
   * `start` — handle is on the left edge of a right panel (drag right → shrink).
   */
  edge?: 'end' | 'start'
  label?: string
}

/** Vertical drag handle between resizable panels. */
export default function PanelResizeHandle({
  onResize,
  onResizeEnd,
  edge = 'start',
  label = 'Resize panels',
}: Props) {
  const dragging = useRef(false)
  const lastX = useRef(0)
  const [active, setActive] = useState(false)

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return
      const dx = e.clientX - lastX.current
      lastX.current = e.clientX
      onResize(edge === 'end' ? dx : -dx)
    },
    [onResize, edge],
  )

  const stop = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    setActive(false)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    onResizeEnd?.()
  }, [onResizeEnd])

  useEffect(() => {
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [onPointerMove, stop])

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize"
      onPointerDown={(e) => {
        e.preventDefault()
        dragging.current = true
        lastX.current = e.clientX
        setActive(true)
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
      }}
      className={`relative w-1.5 flex-shrink-0 cursor-col-resize group select-none
        ${active ? 'bg-bu-500/40' : 'bg-transparent hover:bg-bu-500/25'}`}
    >
      <div className="absolute inset-y-0 -left-1 -right-1 z-20" />
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
          w-1 h-10 rounded-full transition-colors pointer-events-none
          ${active ? 'bg-bu-400' : 'bg-slate-600 group-hover:bg-bu-400'}`}
      />
    </div>
  )
}
