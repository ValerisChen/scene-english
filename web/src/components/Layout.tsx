import { Link, Outlet } from 'react-router'

export function Layout() {
  return (
    <>
      <header
        className="sticky z-10 border-b border-line bg-surface"
        style={{ top: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="wrap flex items-center justify-between gap-3 py-2.5">
          <Link to="/" className="flex items-baseline gap-2 font-display text-xl font-bold">
            逐场英语
            <span className="text-xs font-medium tracking-wider text-ink-3">SCENE BY SCENE</span>
          </Link>
          <nav className="flex gap-2">
            <Link to="/" className="btn">
              片库
            </Link>
            <Link to="/import" className="btn btn-primary">
              导入电影
            </Link>
          </nav>
        </div>
      </header>
      <main className="wrap grid gap-7 pb-16 pt-6">
        <Outlet />
      </main>
    </>
  )
}

export function Meter({ pct, label = '预估听懂率' }: { pct: number; label?: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between text-[13px] text-ink-2">
        <span>{label}</span>
        <b className="font-mono text-2xl text-ink">{pct}%</b>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Spinner() {
  return (
    <span
      className="inline-block size-4 rounded-full border-2 border-accent border-t-transparent"
      style={{ animation: 'spin .8s linear infinite' }}
      aria-hidden
    />
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return <p className="rounded-lg bg-bad-soft px-3.5 py-2.5 text-sm text-bad">{message}</p>
}
