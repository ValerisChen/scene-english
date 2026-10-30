import { useState } from 'react'
import { MicIcon, PlayIcon } from '../../components/icons'
import { playBlob, useRecorder } from '../../lib/recorder'

/**
 * 跟读：录下自己的声音，回放和原声对比。
 * 发音评分在阶段二接入，现在只录音不打分。
 */
export function ShadowButton({ label = '跟读' }: { label?: string }) {
  const { recording, error, start, stop } = useRecorder()
  const [take, setTake] = useState<Blob | null>(null)

  async function toggle() {
    if (recording) {
      const blob = await stop()
      if (blob) setTake(blob)
    } else {
      await start()
    }
  }

  return (
    <>
      <button className={`btn btn-speak ${recording ? 'border-speak!' : ''}`} onClick={toggle}>
        <MicIcon />
        {recording ? '录音中，点击结束' : label}
      </button>
      {take && !recording && (
        <button className="btn" onClick={() => playBlob(take)}>
          <PlayIcon />
          听我的
        </button>
      )}
      {error && <span className="text-xs text-bad">{error}</span>}
    </>
  )
}
