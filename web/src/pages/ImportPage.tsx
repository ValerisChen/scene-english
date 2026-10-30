import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api, type FilmDetail, type Job } from '../api/client'
import { ErrorNote, Spinner } from '../components/Layout'
import { fileFingerprint } from '../lib/fingerprint'
import { duration, megabytes } from '../lib/format'
import { type Picked, pickVideoFile, rememberFile } from '../lib/localFiles'

type StepKey = 'hash' | 'audio' | 'upload' | 'vocals' | 'asr' | 'scene' | 'content'
const STEPS: { key: StepKey; title: string; hint: string }[] = [
  { key: 'hash', title: '计算文件指纹', hint: '读取文件首尾片段，用来认出这个文件' },
  { key: 'audio', title: '在本地提取音轨', hint: '转成单声道，视频本身不上传' },
  { key: 'upload', title: '上传音轨', hint: '' },
  { key: 'vocals', title: '分离人声', hint: '去掉配乐和音效，台词识别更准' },
  { key: 'asr', title: '识别台词和时间轴', hint: '' },
  { key: 'scene', title: '按场景切分', hint: '' },
  { key: 'content', title: '生成单词、搭配、例句和测验', hint: '' },
]
// 后端 job.current_step → 页面上的步骤
const SERVER_STEP: Record<string, StepKey> = {
  audio: 'vocals',
  vocals: 'vocals',
  asr: 'asr',
  scene: 'scene',
  content: 'content',
  done: 'content',
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'local'; step: StepKey; progress: number; detail: Partial<Record<StepKey, string>> }
  | { kind: 'server'; filmId: number; jobId: number; detail: Partial<Record<StepKey, string>> }
  | { kind: 'error'; error: unknown; detail: Partial<Record<StepKey, string>>; failedAt: StepKey }

const titleFromFile = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[._]+/g, ' ')
    .trim()

function StepList({ active, progress, detail, failedAt }: {
  active: StepKey | 'done'
  progress?: number
  detail: Partial<Record<StepKey, string>>
  failedAt?: StepKey
}) {
  const activeIdx = active === 'done' ? STEPS.length : STEPS.findIndex((s) => s.key === active)
  return (
    <ol className="grid gap-2.5">
      {STEPS.map((s, i) => {
        const state = s.key === failedAt ? 'failed' : i < activeIdx ? 'done' : i === activeIdx ? 'run' : 'todo'
        return (
          <li key={s.key} className="grid grid-cols-[22px_1fr] items-start gap-2.5">
            <span className="mt-1 grid size-[18px] place-items-center">
              {state === 'run' && <Spinner />}
              {state === 'done' && <span className="size-3.5 rounded-full bg-good" />}
              {state === 'failed' && <span className="size-3.5 rounded-full bg-bad" />}
              {state === 'todo' && <span className="size-3.5 rounded-full border-2 border-line" />}
            </span>
            <div className="grid min-w-0">
              <b className={`font-medium ${state === 'todo' ? 'text-ink-3' : ''}`}>{s.title}</b>
              <span className="text-[13px] break-words text-ink-3">{detail[s.key] ?? s.hint}</span>
              {state === 'run' && progress !== undefined && (
                <span className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                  <i className="block h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function ServerProgress({ jobId, detail, onDone }: {
  jobId: number
  detail: Partial<Record<StepKey, string>>
  onDone: (job: Job) => void
}) {
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId),
    refetchInterval: (q) => (q.state.data && ['succeeded', 'failed'].includes(q.state.data.status) ? false : 2000),
  })
  const j = job.data
  useEffect(() => {
    if (j?.status === 'succeeded') onDone(j)
    // 只在状态变成"成功"时跳转一次
  }, [j?.status])
  const active: StepKey | 'done' = j?.status === 'succeeded' ? 'done' : SERVER_STEP[j?.current_step ?? ''] ?? 'vocals'
  return (
    <>
      <StepList
        active={active}
        progress={j?.status === 'running' && active === 'content' ? (j.progress - 0.4) / 0.6 : undefined}
        detail={detail}
        failedAt={j?.status === 'failed' ? active === 'done' ? 'content' : active : undefined}
      />
      {j?.status === 'failed' && <ErrorNote error={j.error ?? '处理失败'} />}
      {j?.status === 'queued' && (
        <p className="text-sm text-ink-3">任务在排队。如果一直不动，检查一下 worker 有没有启动。</p>
      )}
    </>
  )
}

export function ImportPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const [picked, setPicked] = useState<Picked | null>(null)
  const [title, setTitle] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const resumeFilm = Number(params.get('film')) || null

  // 从片库点进来的、还在处理中的影片：直接显示服务器进度
  const resume = useQuery({
    queryKey: ['film', resumeFilm],
    queryFn: () => api.film(resumeFilm!),
    enabled: !!resumeFilm && phase.kind === 'idle',
  })
  const resumeJob = resume.data?.latest_job

  async function choose() {
    const p = await pickVideoFile()
    if (!p) return
    setPicked(p)
    setTitle(titleFromFile(p.file.name))
    setPhase({ kind: 'idle' })
  }

  function finished(film: { id: number }) {
    void queryClient.invalidateQueries({ queryKey: ['films'] })
    navigate(`/films/${film.id}`)
  }

  async function start() {
    if (!picked) return
    const file = picked.file
    const detail: Partial<Record<StepKey, string>> = {}
    let at = 'hash' as StepKey
    const local = (step: StepKey, progress = 0) => {
      at = step
      setPhase({ kind: 'local', step, progress, detail: { ...detail } })
    }
    // 音轨提取库比较大，只在导入时加载
    const media = import('../lib/extractAudio')
    try {
      local('hash')
      const { extractAudio, probeDuration } = await media
      const [fingerprint, seconds] = await Promise.all([fileFingerprint(file), probeDuration(file)])
      await rememberFile(fingerprint, picked)
      detail.hash = `指纹 ${fingerprint.slice(0, 12)} · 片长 ${seconds ? duration(seconds) : '未知'}`

      const existing: FilmDetail | null = await api.filmByFingerprint(fingerprint)
      if (existing?.scene_count) return finished(existing)
      if (existing?.latest_job && ['queued', 'running'].includes(existing.latest_job.status)) {
        detail.audio = detail.upload = '之前已经上传过'
        return setPhase({ kind: 'server', filmId: existing.id, jobId: existing.latest_job.id, detail })
      }
      const film =
        existing ??
        (await api.createFilm({ fingerprint, title: title || titleFromFile(file.name), file_name: file.name, duration_sec: seconds }))

      local('audio')
      const audio = await extractAudio(file, (p) => local('audio', p))
      detail.audio = `音轨 ${megabytes(audio.size)}（原视频 ${megabytes(file.size)} 留在本地）`

      local('upload')
      const job = await api.uploadAudio(film.id, audio, 'audio.ogg', (p) => local('upload', p))
      detail.upload = `${megabytes(audio.size)} 已上传`
      setPhase({ kind: 'server', filmId: film.id, jobId: job.id, detail })
    } catch (error) {
      if (at === 'audio') detail.audio = '失败'
      setPhase({ kind: 'error', error, detail, failedAt: at })
    }
  }

  const busy = phase.kind === 'local' || phase.kind === 'server'

  return (
    <>
      <section className="grid gap-1">
        <p className="eyebrow">导入电影</p>
        <h1 className="font-display text-[28px] font-bold">用你自己的电影学</h1>
      </section>

      <p className="rounded-lg bg-speak-soft px-3.5 py-2.5 text-sm text-speak">
        视频文件不会离开你的设备。我们只在本地提取音轨上传，处理完返回带时间轴的学习数据，播放时直接用你本地的文件。
      </p>

      {resumeJob && phase.kind === 'idle' && !picked ? (
        <section className="card grid gap-4">
          <h2 className="font-display text-lg font-bold">{resume.data?.title}</h2>
          {resumeJob.status === 'failed' && (
            <p className="text-sm text-ink-2">上次处理失败了，重新选择这个文件再导入一次即可。</p>
          )}
          <ServerProgress jobId={resumeJob.id} detail={{ hash: '已完成', audio: '已完成', upload: '已完成' }} onDone={() => finished(resume.data!)} />
          <div>
            <button className="btn" onClick={choose}>
              重新选择文件
            </button>
          </div>
        </section>
      ) : (
        <section className="card grid gap-4">
          {!picked ? (
            <button
              className="grid justify-items-center gap-1 rounded-xl border-[1.5px] border-dashed border-ink-3 px-4 py-8 text-center hover:border-accent"
              onClick={choose}
            >
              <b className="font-medium">选择本地视频文件</b>
              <span className="text-[13px] text-ink-3">支持 mp4、mov、mkv。电脑上的 Chrome 或 Edge 会记住这个文件，下次不用重新选。</span>
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <b className="break-all">{picked.file.name}</b>
                <span className="font-mono text-sm text-ink-3">{megabytes(picked.file.size)}</span>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="text-ink-3">影片名</span>
                <input
                  id="film-title"
                  className="rounded-lg border border-line bg-bg px-3 py-2 text-base"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={busy}
                />
              </label>
              {phase.kind === 'idle' && (
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={start}>
                    开始处理
                  </button>
                  <button className="btn" onClick={choose}>
                    换一个文件
                  </button>
                </div>
              )}
              {phase.kind === 'local' && <StepList active={phase.step} progress={phase.progress} detail={phase.detail} />}
              {phase.kind === 'server' && (
                <ServerProgress jobId={phase.jobId} detail={phase.detail} onDone={() => finished({ id: phase.filmId })} />
              )}
              {phase.kind === 'error' && (
                <>
                  <StepList active={phase.failedAt} detail={phase.detail} failedAt={phase.failedAt} />
                  <ErrorNote error={phase.error} />
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={start}>
                      重试
                    </button>
                    <button className="btn" onClick={choose}>
                      换一个文件
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      <p className="text-sm text-ink-3">
        处理一部 3 小时的电影大约要几十分钟，可以先去<Link to="/" className="link">片库</Link>，进度会保留。
      </p>
    </>
  )
}
