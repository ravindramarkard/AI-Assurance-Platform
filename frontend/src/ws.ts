import type { Event } from './api'

export function connectSessionWs(
  sessionId: string,
  onEvent: (ev: Event) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  const url = `${proto}://${window.location.host}/ws/sessions/${sessionId}`
  let ws: WebSocket | null = null
  let closed = false
  let pingTimer: number | undefined
  let retryTimer: number | undefined

  const connect = () => {
    if (closed) return
    ws = new WebSocket(url)
    ws.onopen = () => {
      onStatus?.(true)
      pingTimer = window.setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send('ping')
      }, 25000)
    }
    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as Event
        onEvent(data)
      } catch {
        /* ignore */
      }
    }
    ws.onclose = () => {
      onStatus?.(false)
      if (pingTimer) window.clearInterval(pingTimer)
      if (!closed) {
        retryTimer = window.setTimeout(connect, 1500)
      }
    }
    ws.onerror = () => {
      ws?.close()
    }
  }

  connect()

  return () => {
    closed = true
    if (pingTimer) window.clearInterval(pingTimer)
    if (retryTimer) window.clearTimeout(retryTimer)
    ws?.close()
  }
}
