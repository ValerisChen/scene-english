import { useEffect, useState } from 'react'
import { bindFile, restoreStoredFile, storedFileName } from '../../lib/localFiles'

/** 这一步需要播放视频，但本次还没拿到本地文件时显示。 */
export function FileBinder({ fingerprint, onFile }: { fingerprint: string; onFile: (f: File) => void }) {
  const [remembered, setRemembered] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void storedFileName(fingerprint).then(setRemembered)
  }, [fingerprint])

  async function restore() {
    const f = await restoreStoredFile(fingerprint)
    if (f) onFile(f)
    else setError('没有拿到读取权限，请重新选择文件')
  }

  async function pick() {
    setError(null)
    const f = await bindFile(fingerprint)
    if (f === 'mismatch') setError('这不是导入时的那个文件（指纹对不上），换一个试试')
    else if (f) onFile(f)
  }

  return (
    <div className="grid aspect-video max-h-[440px] w-full place-items-center rounded-xl bg-screen p-4 text-center text-screen-ink">
      <div className="grid justify-items-center gap-3">
        <p className="max-w-[36ch] text-sm opacity-80">这一步要配合视频学。请选择导入时用的那个本地视频文件。</p>
        <div className="flex flex-wrap justify-center gap-2">
          {remembered && (
            <button className="btn btn-primary" onClick={restore}>
              继续使用 {remembered}
            </button>
          )}
          <button className="btn border-screen-ink/40 bg-transparent text-screen-ink" onClick={pick}>
            选择视频文件
          </button>
        </div>
        {error && <p className="text-sm text-[#F07A6E]">{error}</p>}
      </div>
    </div>
  )
}
