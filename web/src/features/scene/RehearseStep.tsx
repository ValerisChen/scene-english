import { useEffect, useMemo, useRef, useState } from 'react'
import type { LineContent } from '../../api/client'
import { MicIcon, PlayIcon } from '../../components/icons'
import { playRange, stopRange, usePlayer } from '../../lib/player'
import { playBlob, useRecorder } from '../../lib/recorder'

type Mode = 'line' | 'dub'
const TAIL = 0.15

/** 对戏：用户演一个角色，其他角色的台词播放原片。 */
export function RehearseStep({ lines }: { lines: LineContent[] }) {
  const speakers = useMemo(() => [...new Set(lines.map((l) => l.speaker).filter((s) => s !== '?'))], [lines])
  const [role, setRole] = useState(speakers[0] ?? '?')
  const [mode, setMode] = useState<Mode>('line')
  const [hide, setHide] = useState(false)
  const [running, setRunning] = useState(false)
  const [idx, setIdx] = useState(-1)
  const [waiting, setWaiting] = useState(false)
  const [takes, setTakes] = useState<Record<number, Blob>>({})
  const recorder = useRecorder()
  const run = useRef(0)
  const resume = useRef<(() => void) | null>(null)
  const setPlayer = usePlayer((s) => s.set)

  useEffect(
    () => () => {
      run.current++
      resume.current?.()
    },
    [],
  )

  async function record(i: number, during: () => Promise<unknown>) {
    if (!(await recorder.start())) return false
    await during()
    const blob = await recorder.stop()
    if (blob) setTakes((t) => ({ ...t, [i]: blob }))
    return true
  }

  async function start() {
    const mine = ++run.current
    setRunning(true)
    setTakes({})
    for (let i = 0; i < lines.length; i++) {
      if (mine !== run.current) return
      const line = lines[i]
      setIdx(i)
      const isMine = line.speaker === role
      setPlayer({ subtitles: !(hide && isMine) })
      if (!isMine) {
        await playRange(line.start, line.end + TAIL)
        continue
      }
      const ok =
        mode === 'dub'
          ? // 配音：画面照常走，静音（人声分离做好之前先整体静音），边播边录
            await record(i, () => playRange(line.start, line.end + TAIL, { muted: true }))
          : // 对台词：画面停住，等用户说完
            await record(i, () => {
              stopRange()
              setWaiting(true)
              return new Promise<void>((r) => (resume.current = r))
            })
      setWaiting(false)
      if (!ok) break
    }
    if (mine !== run.current) return
    setPlayer({ subtitles: true })
    setRunning(false)
    setIdx(-1)
  }

  function stop() {
    run.current++
    resume.current?.()
    stopRange()
    void recorder.stop()
    setPlayer({ subtitles: true })
    setRunning(false)
    setWaiting(false)
    setIdx(-1)
  }

  function finishLine() {
    resume.current?.()
    resume.current = null
  }

  const seg = (on: boolean) => `rounded-full px-3 py-1 text-sm ${on ? 'bg-ink text-bg' : ''}`

  return (
    <>
      <p className="text-ink-2">和片中角色对戏。你选一个角色，其他角色的台词播放原片声音，轮到你时开口。</p>
      <div className="card grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap gap-2">
            <div className="inline-flex flex-wrap rounded-full border border-line bg-surface p-0.5" role="group" aria-label="选择角色">
              {(speakers.length ? speakers : ['?']).map((s) => (
                <button key={s} className={seg(role === s)} onClick={() => setRole(s)} disabled={running}>
                  我演 {s === '?' ? '未知角色' : s}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-full border border-line bg-surface p-0.5" role="group" aria-label="练习模式">
              <button className={seg(mode === 'line')} onClick={() => setMode('line')} disabled={running}>
                对台词
              </button>
              <button className={seg(mode === 'dub')} onClick={() => setMode('dub')} disabled={running}>
                配音
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => setHide(!hide)} disabled={running}>
              {hide ? '显示我的台词' : '挑战：隐藏我的台词'}
            </button>
            {running ? (
              <button className="btn" onClick={stop}>
                停止
              </button>
            ) : (
              <button className="btn btn-primary" onClick={start}>
                {Object.keys(takes).length ? '再演一遍' : '开始对戏'}
              </button>
            )}
          </div>
        </div>
        <p className="text-[13px] text-ink-2">
          {mode === 'dub'
            ? '配音：轮到你时画面照常播放但没有声音，由你来配。去掉单个角色人声、只留背景音的功能还没做，现在是整体静音。'
            : '对台词：轮到你时画面停住，说完点“说完了”再接着往下演。'}
        </p>
        {recorder.error && <p className="text-sm text-bad">{recorder.error}</p>}
      </div>

      <div className="grid gap-1.5">
        {lines.map((line, i) => {
          const mine = line.speaker === role
          const now = idx === i
          const hidden = mine && hide && !takes[i]
          return (
            <div
              key={i}
              className={`grid grid-cols-[64px_1fr] items-start gap-2.5 rounded-[10px] border px-3 py-2.5 sm:grid-cols-[64px_1fr_auto] ${
                now ? 'border-accent bg-surface' : mine ? 'border-transparent bg-speak-soft' : 'border-transparent'
              }`}
            >
              <span className={`pt-0.5 font-mono text-xs uppercase ${mine ? 'text-speak' : 'text-ink-3'}`}>{line.speaker}</span>
              <span className="grid min-w-0 gap-0.5">
                <b className={`font-medium ${hidden ? 'blur-[5px] select-none' : ''}`}>{line.text}</b>
                <span className="text-[13px] text-ink-3">{line.zh}</span>
              </span>
              <span className="col-start-2 flex flex-wrap gap-2 sm:col-start-3">
                {now && waiting && (
                  <button className="btn btn-speak" onClick={finishLine}>
                    <MicIcon />
                    录音中，说完了
                  </button>
                )}
                {now && running && !waiting && mine && <span className="text-[13px] text-speak">录音中…</span>}
                {takes[i] && !now && (
                  <>
                    <button className="btn" onClick={() => playBlob(takes[i])}>
                      <PlayIcon />
                      听我的
                    </button>
                    <button className="btn" onClick={() => playRange(line.start, line.end + TAIL)}>
                      听原声
                    </button>
                  </>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}
