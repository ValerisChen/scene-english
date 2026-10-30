import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router'
import { api, type FilmDetail } from '../api/client'
import { ErrorNote, Spinner } from '../components/Layout'
import { db } from '../lib/db'
import { duration } from '../lib/format'

function JobBadge({ film }: { film: FilmDetail }) {
  const job = film.latest_job
  if (film.scene_count > 0) return <span className="tag tag-good">{film.scene_count} 个场景</span>
  if (!job) return <span className="tag">还没上传音轨</span>
  if (job.status === 'failed') return <span className="tag tag-bad">处理失败</span>
  return <span className="tag tag-accent">处理中 {Math.round(job.progress * 100)}%</span>
}

function FilmCard({ film }: { film: FilmDetail }) {
  const passed = useLiveQuery(() => db.progress.where('filmId').equals(film.id).filter((p) => p.passed).count(), [film.id])
  const ready = film.scene_count > 0
  return (
    <Link
      to={ready ? `/films/${film.id}` : `/import?film=${film.id}`}
      className="card grid gap-2 hover:border-ink-3"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-lg font-bold">{film.title}</h3>
        <JobBadge film={film} />
      </div>
      <p className="text-sm text-ink-3">
        {film.duration_sec ? duration(film.duration_sec) : '片长未知'}
        {ready && ` · 已通关 ${passed ?? 0} / ${film.scene_count}`}
      </p>
    </Link>
  )
}

export function LibraryPage() {
  const films = useQuery({ queryKey: ['films'], queryFn: api.films })

  return (
    <>
      <section className="grid gap-1">
        <p className="eyebrow">片库</p>
        <h1 className="font-display text-[28px] font-bold">选一部电影，逐场攻克</h1>
      </section>

      {films.isPending && <Spinner />}
      {films.isError && <ErrorNote error={films.error} />}
      {films.data?.length === 0 && (
        <section className="card grid gap-3 border-dashed">
          <h2 className="font-display text-lg font-bold">还没有影片</h2>
          <p className="text-ink-2">
            导入一部你电脑上的电影。视频留在你的设备上，只在本地提取音轨上传，用来识别台词和切分场景。
          </p>
          <p className="text-sm text-ink-3">
            还没配置 API key 的话，可以先在 backend 目录运行{' '}
            <code className="font-mono">uv run scene-english seed-demo</code> 写入一份示例场景。
          </p>
          <div>
            <Link to="/import" className="btn btn-primary">
              导入电影
            </Link>
          </div>
        </section>
      )}
      {!!films.data?.length && (
        <section className="grid gap-3 sm:grid-cols-2">
          {films.data.map((f) => (
            <FilmCard key={f.id} film={f} />
          ))}
        </section>
      )}
    </>
  )
}
