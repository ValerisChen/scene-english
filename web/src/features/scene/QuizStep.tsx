import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link } from 'react-router'
import type { LineContent, QuizQuestion } from '../../api/client'
import { PlayIcon } from '../../components/icons'
import { db, savePassed } from '../../lib/db'
import { duration } from '../../lib/format'
import { playRange, stopRange } from '../../lib/player'

/** 通关：字幕关闭，先无字幕看完整场，再答理解题。 */
export function QuizStep({ filmId, sceneId, lines, quiz }: {
  filmId: number
  sceneId: number
  lines: LineContent[]
  quiz: QuizQuestion[]
}) {
  const [watched, setWatched] = useState(false)
  const [watching, setWatching] = useState(false)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const already = useLiveQuery(() => db.progress.get(sceneId), [sceneId])?.passed

  const first = lines[0]
  const last = lines[lines.length - 1]
  const need = Math.ceil(quiz.length * 0.75)
  const right = quiz.filter((q, i) => answers[i] === q.answer_index).length
  const pass = right >= need

  async function watch() {
    setWatching(true)
    const result = await playRange(first.start, last.end + 0.5)
    setWatching(false)
    if (result === 'ended') setWatched(true)
  }

  async function submit() {
    setSubmitted(true)
    if (right >= need) await savePassed(filmId, sceneId, right / Math.max(quiz.length, 1))
  }

  if (!watched) {
    return (
      <>
        <p className="text-ink-2">
          最后一关：字幕已关闭。先把整场完整看一遍，再回答 {quiz.length} 道理解题，答对 {need} 道就算通关。
          {already && ' 这一场你已经通关过了。'}
        </p>
        <div className="card flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="grid gap-0.5">
            <b className="font-medium">无字幕观看本场</b>
            <span className="text-sm text-ink-3">{duration(last.end - first.start)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {watching ? (
              <button className="btn" onClick={() => stopRange()}>
                停止
              </button>
            ) : (
              <button className="btn btn-primary" onClick={watch}>
                <PlayIcon />
                开始观看
              </button>
            )}
            <button className="link text-sm" onClick={() => setWatched(true)}>
              跳过，直接答题
            </button>
          </div>
        </div>
      </>
    )
  }

  if (!quiz.length) {
    return (
      <div className="card grid gap-3">
        <p>这一场没有生成测验题。看懂了的话可以直接标记通关。</p>
        <div>
          <button className="btn btn-primary" onClick={() => savePassed(filmId, sceneId, 1)}>
            标记为通关
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <p className="text-ink-2">凭刚才听到的回答下面的问题，答对 {need} 道就算通关。</p>
      {quiz.map((q, qi) => (
        <article key={qi} className="card grid gap-2">
          <h3 className="text-[15px] font-medium">
            {qi + 1}. {q.question_zh}
          </h3>
          {q.audio_line_idx !== null && lines[q.audio_line_idx] && (
            <div>
              <button
                className="btn btn-speak"
                onClick={() => playRange(lines[q.audio_line_idx!].start, lines[q.audio_line_idx!].end + 0.15)}
              >
                <PlayIcon />
                播放这句台词
              </button>
            </div>
          )}
          <div className="grid gap-1.5">
            {q.options.map((o, oi) => {
              const chosen = answers[qi] === oi
              let cls = chosen ? 'border-ink shadow-[inset_0_0_0_1px_var(--ink)]' : 'border-line'
              if (submitted) {
                cls = oi === q.answer_index ? 'border-good bg-good-soft' : chosen ? 'border-bad bg-bad-soft' : 'border-line'
              }
              return (
                <button
                  key={oi}
                  className={`rounded-lg border bg-surface px-3 py-2 text-left ${cls}`}
                  onClick={() => setAnswers({ ...answers, [qi]: oi })}
                  disabled={submitted}
                >
                  {o}
                </button>
              )
            })}
          </div>
        </article>
      ))}
      {submitted ? (
        <div className={`grid gap-1.5 rounded-xl px-4.5 py-4 ${pass ? 'bg-good-soft' : 'bg-bad-soft'}`}>
          <h3 className="font-display text-xl font-bold">{pass ? '本场通关' : '还差一点'}</h3>
          <p>
            答对 {right} / {quiz.length}。
            {pass ? '去场景列表看看下一场吧。' : '回到“精听”把没听清的句子再循环几遍，然后重新挑战。'}
          </p>
          <div className="flex flex-wrap gap-2">
            {pass && (
              <Link to={`/films/${filmId}`} className="btn btn-primary">
                回到场景列表
              </Link>
            )}
            <button
              className="btn"
              onClick={() => {
                setAnswers({})
                setSubmitted(false)
              }}
            >
              重新答题
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={submit} disabled={Object.keys(answers).length < quiz.length}>
            提交答案
          </button>
        </div>
      )}
    </>
  )
}
