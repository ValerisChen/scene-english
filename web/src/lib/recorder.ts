import { useEffect, useRef, useState } from 'react'

/**
 * 录音，用于跟读和对戏。阶段一只录下来让用户回放对比；
 * 发音评分在阶段二接入评测服务。
 */
export function useRecorder() {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])

  useEffect(
    () => () => {
      stream.current?.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  async function start() {
    setError(null)
    try {
      stream.current ??= await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('没有拿到麦克风权限，请在浏览器地址栏里允许使用麦克风')
      return false
    }
    chunks.current = []
    const r = new MediaRecorder(stream.current)
    r.ondataavailable = (e) => chunks.current.push(e.data)
    r.start()
    recorder.current = r
    setRecording(true)
    return true
  }

  function stop(): Promise<Blob | null> {
    const r = recorder.current
    if (!r || r.state === 'inactive') return Promise.resolve(null)
    return new Promise((resolve) => {
      r.onstop = () => {
        setRecording(false)
        resolve(new Blob(chunks.current, { type: r.mimeType }))
      }
      r.stop()
    })
  }

  return { recording, error, start, stop }
}

let playing: HTMLAudioElement | null = null

export function playBlob(blob: Blob) {
  playing?.pause()
  const url = URL.createObjectURL(blob)
  playing = new Audio(url)
  playing.onended = () => URL.revokeObjectURL(url)
  void playing.play()
}
