import { useEffect, useRef, useState } from 'react'
import type { LineContent, WordCard } from '../../api/client'
import { LoopIcon, NextIcon, PlayIcon, PrevIcon } from '../../components/icons'
import { Markup, MarkupLegend } from '../../components/Markup'
import { clock } from '../../lib/format'
import { playRange, usePlayer } from '../../lib/player'
import { ShadowButton } from './ShadowButton'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// 句尾多留一点，免得把最后一个音切掉
const TAIL = 0.15

/** 精听：跟着视频逐句听。点哪句跳到哪句；视频自己播放时，列表跟着画面走。 */
export function ListenStep({ lines, words }: { lines: LineContent[]; words: WordCard[] }) {
  const { activeLine, showZh, set } = usePlayer()
  const [cur, setCur] = useState(0)
  const [loop, setLoop] = useState(false)
  const [slow, setSlow] = useState(false)
  const opts = useRef({ loop, slow })
  opts.current = { loop, slow }
  const run = useRef(0)
  const curRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeLine !== null) setCur(activeLine)
  }, [activeLine])

  useEffect(() => {
    curRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [cur])

  async function play(i: number) {
    const idx = Math.max(0, Math.min(lines.length - 1, i))
    const mine = ++run.current
    setCur(idx)
    for (;;) {
      const line = lines[idx]
      const result = await playRange(line.start, line.end + TAIL, { rate: opts.current.slow ? 0.75 : 1 })
      if (result !== 'ended' || !opts.current.loop) return
      await sleep(600)
      if (mine !== run.current || !opts.current.loop) return
    }
  }

  function toggleLoop() {
    setLoop(!loop)
    opts.current.loop = !loop
    if (!loop) void play(cur)
  }

  return (
    <>
      <p className="text-ink-2">
        跟着视频逐句听。点任意一句，画面就跳过去；预习过的词在字幕里高亮，点一下就能回看单词卡。
      </p>
      <MarkupLegend />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => play(cur - 1)} disabled={cur === 0}>
            <PrevIcon />
            上一句
          </button>
          <button className="btn btn-primary" onClick={() => play(cur)}>
            <PlayIcon />
            播放本句
          </button>
          <button className="btn" onClick={() => play(cur + 1)} disabled={cur === lines.length - 1}>
            下一句
            <NextIcon />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={`btn ${loop ? 'btn-on' : ''}`} aria-pressed={loop} onClick={toggleLoop}>
            <LoopIcon />
            循环
          </button>
          <button className={`btn ${slow ? 'btn-on' : ''}`} aria-pressed={slow} onClick={() => setSlow(!slow)}>
            0.75x
          </button>
          <button className={`btn ${showZh ? 'btn-on' : ''}`} aria-pressed={showZh} onClick={() => set({ showZh: !showZh })}>
            中文
          </button>
        </div>
      </div>

      <div className="grid gap-1">
        {lines.map((line, i) => {
          const isCur = i === cur
          const vocab = words.map((w, wi) => ({ w, wi })).filter(({ w }) => w.line_idx === i)
          return (
            <div
              key={i}
              ref={isCur ? curRef : undefined}
              className={`grid gap-2 rounded-[10px] border px-3 py-2 ${isCur ? 'border-accent bg-surface py-3' : 'border-transparent'}`}
            >
              <button className="group grid w-full grid-cols-1 gap-0.5 text-left sm:grid-cols-[64px_1fr] sm:gap-2.5" onClick={() => play(i)}>
                <span className="flex gap-2 text-xs text-ink-3 sm:grid sm:gap-0 sm:pt-1">
                  <span className="font-mono">{clock(line.start)}</span>
                  <span>{line.speaker}</span>
                </span>
                <span
                  className={`leading-[1.7] ${isCur ? 'text-[19px] font-medium text-ink' : 'text-base text-ink-2 group-hover:text-ink'}`}
                >
                  {isCur ? <Markup markup={line.markup} /> : line.text}
                </span>
              </button>
              {showZh && <p className="text-sm text-ink-2 sm:ml-[74px]">{line.zh}</p>}
              {isCur && (
                <div className="grid gap-2.5 sm:ml-[74px]">
                  {line.notes.length > 0 && (
                    <ul className="m-0 grid gap-0.5 pl-[18px] text-sm text-ink-2">
                      {line.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  )}
                  {vocab.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-3">
                      本句生词
                      {vocab.map(({ w, wi }) => (
                        <button key={wi} className="rounded-full bg-accent-soft px-2.5 text-[13px] text-accent" onClick={() => set({ openWord: wi })}>
                          {w.text}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <ShadowButton label="跟读这句" />
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
