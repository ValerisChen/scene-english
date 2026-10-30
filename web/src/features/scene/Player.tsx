import { useEffect, useMemo, useRef } from 'react'
import type { LineContent, WordCard } from '../../api/client'
import { usePlayer } from '../../lib/player'

/** 当前时间落在哪一句台词里（两句之间的空档算前一句）。 */
export function lineAt(lines: LineContent[], t: number): number | null {
  if (!lines.length || t < lines[0].start - 0.2 || t > lines[lines.length - 1].end + 1) return null
  let idx = 0
  lines.forEach((l, i) => {
    if (l.start - 0.2 <= t) idx = i
  })
  return idx
}

/** 字幕：本场生词高亮，点一下弹出单词卡。 */
function Subtitle({ line, words }: { line: LineContent; words: WordCard[] }) {
  const { showZh, set } = usePlayer()
  const lower = line.text.toLowerCase()
  const hits = words
    .map((w, i) => ({ i, at: w.highlight ? lower.indexOf(w.highlight.toLowerCase()) : -1, len: w.highlight.length }))
    .filter((h) => h.at >= 0)
    .sort((a, b) => a.at - b.at)
  const nodes: React.ReactNode[] = []
  let pos = 0
  for (const h of hits) {
    if (h.at < pos) continue
    nodes.push(line.text.slice(pos, h.at))
    nodes.push(
      <mark
        key={h.i}
        className="pointer-events-auto cursor-pointer rounded-sm border-b-2 border-[#F0A54A] bg-[#F0A54A]/20 px-0.5 text-subtitle"
        onClick={() => set({ openWord: h.i })}
      >
        {line.text.slice(h.at, h.at + h.len)}
      </mark>,
    )
    pos = h.at + h.len
  }
  nodes.push(line.text.slice(pos))
  return (
    <>
      {nodes}
      {showZh && <span className="block text-[0.8em] font-normal text-screen-ink/85">{line.zh}</span>}
    </>
  )
}

export function Player({ file, lines, words }: { file: File; lines: LineContent[]; words: WordCard[] }) {
  const { activeLine, subtitles, set } = usePlayer()
  const url = useMemo(() => URL.createObjectURL(file), [file])
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => () => URL.revokeObjectURL(url), [url])

  useEffect(() => {
    const video = ref.current
    if (!video) return
    set({ video, activeLine: null })
    const onTime = () => {
      const idx = lineAt(lines, video.currentTime)
      if (idx !== usePlayer.getState().activeLine) set({ activeLine: idx })
    }
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('seeked', onTime)
    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('seeked', onTime)
      set({ video: null })
    }
  }, [lines, set])

  // 第一次打开时停在本场开头
  const onLoaded = () => {
    if (ref.current && lines.length) ref.current.currentTime = lines[0].start
  }

  const line = activeLine !== null ? lines[activeLine] : null
  return (
    <div className="relative aspect-video max-h-[440px] w-full overflow-hidden rounded-xl bg-screen">
      <video ref={ref} src={url} controls playsInline className="size-full bg-black object-contain" onLoadedMetadata={onLoaded} />
      <div className="pointer-events-none absolute inset-x-0 bottom-14 px-4 text-center text-[clamp(15px,2.6vw,20px)] font-medium text-subtitle [text-shadow:0_1px_2px_#000]">
        {!subtitles ? (
          <span className="text-[13px] font-normal text-screen-ink/60">字幕已关闭</span>
        ) : (
          line && <Subtitle line={line} words={words} />
        )}
      </div>
    </div>
  )
}
