import { create } from 'zustand'

export type RangeResult = 'ended' | 'interrupted'

interface PlayerState {
  video: HTMLVideoElement | null
  /** 视频当前播到的台词（场景内序号） */
  activeLine: number | null
  subtitles: boolean
  showZh: boolean
  /** 弹出的单词卡（单词序号） */
  openWord: number | null
  set: (patch: Partial<Omit<PlayerState, 'set'>>) => void
}

export const usePlayer = create<PlayerState>((set) => ({
  video: null,
  activeLine: null,
  subtitles: true,
  showZh: false,
  openWord: null,
  set: (patch) => set(patch),
}))

let token = 0
let cancelCurrent: (() => void) | null = null

/** 停止正在进行的片段播放。 */
export function stopRange() {
  token++
  cancelCurrent?.()
  cancelCurrent = null
  usePlayer.getState().video?.pause()
}

/**
 * 播放本地视频的一段，到 end 秒自动暂停。新的调用会打断上一次。
 * 用 requestAnimationFrame 检查进度，比 timeupdate（每秒约 4 次）停得准。
 */
export function playRange(start: number, end: number, opts: { rate?: number; muted?: boolean } = {}) {
  const video = usePlayer.getState().video
  stopRange()
  if (!video) return Promise.resolve<RangeResult>('interrupted')
  const mine = ++token
  video.playbackRate = opts.rate ?? 1
  video.muted = opts.muted ?? false
  video.currentTime = start

  return new Promise<RangeResult>((resolve) => {
    let frame = 0
    const finish = (result: RangeResult) => {
      cancelAnimationFrame(frame)
      video.removeEventListener('pause', onPause)
      video.muted = false
      if (cancelCurrent === cancel) cancelCurrent = null
      resolve(result)
    }
    const cancel = () => finish('interrupted')
    const onPause = () => {
      // 用户手动暂停或拖动进度条
      if (video.currentTime < end - 0.05) finish('interrupted')
    }
    const tick = () => {
      if (mine !== token) return finish('interrupted')
      if (video.currentTime >= end) {
        video.pause()
        return finish('ended')
      }
      frame = requestAnimationFrame(tick)
    }
    cancelCurrent = cancel
    video.addEventListener('pause', onPause)
    video
      .play()
      .then(() => {
        frame = requestAnimationFrame(tick)
      })
      .catch(() => finish('interrupted'))
  })
}
