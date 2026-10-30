import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useParams } from 'react-router'
import { api } from '../api/client'
import { ErrorNote, Meter, Spinner } from '../components/Layout'
import { db } from '../lib/db'
import { clock, duration, sceneLabel } from '../lib/format'
import { comprehension, sceneStatuses } from '../lib/progress'

const CHIP = {
  passed: <span className="tag tag-good">已通关</span>,
  current: <span className="tag tag-accent">学习中</span>,
  todo: <span className="tag">未开始</span>,
}

export function FilmPage() {
  const filmId = Number(useParams().filmId)
  const film = useQuery({ queryKey: ['film', filmId], queryFn: () => api.film(filmId) })
  const scenes = useQuery({ queryKey: ['scenes', filmId], queryFn: () => api.scenes(filmId) })
  const progress = useLiveQuery(() => db.progress.where('filmId').equals(filmId).toArray(), [filmId]) ?? []

  if (film.isError || scenes.isError) return <ErrorNote error={film.error ?? scenes.error} />
  if (!film.data || !scenes.data) return <Spinner />

  const list = scenes.data
  const c = comprehension(list, progress)
  const status = sceneStatuses(list, progress)
  const next = list.find((s) => status.get(s.id) === 'current')

  return (
    <>
      <div className="-mb-3">
        <Link to="/" className="link">
          ← 片库
        </Link>
      </div>
      <header className="grid gap-3">
        <p className="eyebrow">
          {film.data.duration_sec ? duration(film.data.duration_sec) : ''} · {list.length} 个场景
        </p>
        <h1 className="font-display text-[28px] font-bold">{film.data.title}</h1>
        <Meter pct={c.pct} />
        <dl className="m-0 flex flex-wrap gap-x-6 gap-y-2">
          {[
            ['已通关场景', `${c.passed} / ${list.length}`],
            ['已学生词', `${c.words}`],
            ['剩余片长', duration(c.leftSec)],
          ].map(([k, v]) => (
            <div key={k} className="grid">
              <dt className="text-xs text-ink-3">{k}</dt>
              <dd className="m-0 font-medium tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {next && (
          <div>
            <Link to={`/films/${filmId}/scenes/${next.id}`} className="btn btn-primary">
              继续 {sceneLabel(next.seq)} · {next.title_zh}
            </Link>
          </div>
        )}
      </header>

      <p className="rounded-lg bg-surface-2 px-3.5 py-2.5 text-sm text-ink-2">
        越往后生词越少：前面场景学过的词，后面就不再算生词了。
      </p>

      <ol className="m-0 grid list-none gap-2 p-0">
        {list.map((s) => {
          const st = status.get(s.id)!
          return (
            <li key={s.id}>
              <Link
                to={`/films/${filmId}/scenes/${s.id}`}
                className={`grid grid-cols-[64px_1fr] items-center gap-3.5 rounded-[10px] border bg-surface px-3.5 py-3 hover:border-ink-3 sm:grid-cols-[64px_1fr_auto] ${
                  st === 'current' ? 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]' : 'border-line'
                }`}
              >
                <span className="slate text-center">{sceneLabel(s.seq)}</span>
                <span className="grid min-w-0">
                  <b className="font-medium">{s.title_zh}</b>
                  <span className="text-[13px] text-ink-3">
                    <span className="font-mono">
                      {clock(s.start_ms / 1000)} – {clock(s.end_ms / 1000)}
                    </span>{' '}
                    · {s.title_en}
                  </span>
                </span>
                <span className="col-start-2 flex items-center gap-2.5 text-[13px] sm:col-start-3 sm:grid sm:justify-items-end sm:gap-1">
                  {CHIP[st]}
                  <span className="tabular-nums text-ink-2">生词 {s.word_count}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </>
  )
}
