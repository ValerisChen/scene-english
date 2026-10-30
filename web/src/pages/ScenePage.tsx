import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { api } from '../api/client'
import { ErrorNote, Spinner } from '../components/Layout'
import { FileBinder } from '../features/scene/FileBinder'
import { ListenStep } from '../features/scene/ListenStep'
import { Player } from '../features/scene/Player'
import { QuizStep } from '../features/scene/QuizStep'
import { RehearseStep } from '../features/scene/RehearseStep'
import { WordCardView, WordModal } from '../features/scene/WordCardView'
import { db, saveStep } from '../lib/db'
import { clock, duration, sceneLabel } from '../lib/format'
import { getLocalFile } from '../lib/localFiles'
import { stopRange, usePlayer } from '../lib/player'

// 四步按"和视频的关系"划分：先认识词 → 再听懂声音 → 然后开口 → 最后检验
const STEPS = [
  { title: '预习', kind: '自主学' },
  { title: '精听', kind: '看片' },
  { title: '对戏', kind: '开口' },
  { title: '通关', kind: '检验' },
]

export function ScenePage() {
  const filmId = Number(useParams().filmId)
  const sceneId = Number(useParams().sceneId)
  const film = useQuery({ queryKey: ['film', filmId], queryFn: () => api.film(filmId) })
  const scene = useQuery({ queryKey: ['scene', sceneId], queryFn: () => api.scene(sceneId) })
  const [file, setFile] = useState<File | null>(null)
  const [step, setStep] = useState(0)
  const setPlayer = usePlayer((s) => s.set)
  const fingerprint = film.data?.fingerprint
  const knownCount = useLiveQuery(
    async () => {
      const lemmas = scene.data?.content.words.map((w) => w.lemma) ?? []
      return (await db.words.bulkGet(lemmas)).filter((w) => w?.known).length
    },
    [scene.data],
  )

  useEffect(() => {
    if (fingerprint) void getLocalFile(fingerprint).then((f) => f && setFile(f))
  }, [fingerprint])

  useEffect(() => {
    stopRange()
    // 通关这一步关字幕，其余步骤开字幕
    setPlayer({ subtitles: step !== 3, openWord: null })
    void saveStep(filmId, sceneId, step)
  }, [step, filmId, sceneId, setPlayer])

  useEffect(
    () => () => {
      stopRange()
      setPlayer({ subtitles: true, openWord: null })
    },
    [setPlayer],
  )

  if (film.isError || scene.isError) return <ErrorNote error={film.error ?? scene.error} />
  if (!film.data || !scene.data) return <Spinner />

  const s = scene.data
  const { lines, words, quiz } = s.content

  return (
    <>
      <div className="-mb-3">
        <Link to={`/films/${filmId}`} className="link">
          ← 全部场景
        </Link>
      </div>
      <header className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
          <span className="slate">{sceneLabel(s.seq)}</span>
          <span className="font-mono">
            {clock(s.start_ms / 1000)} – {clock(s.end_ms / 1000)}
          </span>
          <span>· {duration((s.end_ms - s.start_ms) / 1000)}</span>
        </div>
        <h1 className="font-display text-[26px] font-bold">{s.title_zh}</h1>
        <p className="text-ink-2">
          {s.title_en}
          {s.summary_zh && ` · ${s.summary_zh}`}
        </p>
      </header>

      <nav className="grid grid-cols-4 gap-1.5" aria-label="学习步骤">
        {STEPS.map((st, i) => (
          <button
            key={st.title}
            className={`grid min-w-0 justify-items-center gap-0.5 rounded-[10px] border px-1.5 py-2 text-center sm:justify-items-start sm:px-2.5 sm:text-left ${
              i === step ? 'border-ink bg-ink text-bg' : 'border-line bg-surface'
            }`}
            onClick={() => setStep(i)}
            aria-current={i === step ? 'step' : undefined}
          >
            <span className={`max-w-full truncate font-mono text-[11px] ${i === step ? 'opacity-70' : 'text-ink-3'}`}>
              0{i + 1} · {st.kind}
            </span>
            <b className="text-sm font-medium">{st.title}</b>
          </button>
        ))}
      </nav>

      {/* 预习不看视频；播放器在其他步骤之间保持挂载，切换步骤不会重新加载视频 */}
      <div hidden={step === 0}>
        {file ? (
          <Player file={file} lines={lines} words={words} />
        ) : (
          fingerprint && <FileBinder fingerprint={fingerprint} onFile={setFile} />
        )}
      </div>

      <section className="grid gap-3.5">
        {step === 0 && (
          <>
            <p className="text-ink-2">
              先不看片，把这一场的 <b>{words.length}</b> 个生词学了。每个词连同搭配和例句一起看，标着“本片”的用法会在后面的场景再遇到。
              {!!knownCount && ` 已掌握 ${knownCount} / ${words.length}。`}
            </p>
            {words.map((w) => (
              <WordCardView key={w.text} word={w} line={lines[w.line_idx]} />
            ))}
          </>
        )}
        {step > 0 && !file && <p className="text-sm text-ink-3">选好视频文件后就可以开始了。</p>}
        {step === 1 && file && <ListenStep lines={lines} words={words} />}
        {step === 2 && file && <RehearseStep lines={lines} />}
        {step === 3 && file && <QuizStep filmId={filmId} sceneId={sceneId} lines={lines} quiz={quiz} />}
        {step < 3 && (
          <div className="flex justify-end pt-1">
            <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
              下一步：{STEPS[step + 1].title} →
            </button>
          </div>
        )}
      </section>

      <WordModal words={words} lines={lines} />
    </>
  )
}
