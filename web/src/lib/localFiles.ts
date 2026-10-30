import { db } from './db'
import { fileFingerprint } from './fingerprint'

// File System Access API 还没进 TypeScript 的标准 DOM 类型
interface PickerWindow {
  showOpenFilePicker?: (options: {
    types?: { description: string; accept: Record<string, string[]> }[]
    multiple?: boolean
  }) => Promise<FileSystemFileHandle[]>
}
type PermissionedHandle = FileSystemFileHandle & {
  queryPermission?: (d: { mode: 'read' }) => Promise<PermissionState>
  requestPermission?: (d: { mode: 'read' }) => Promise<PermissionState>
}

const VIDEO_TYPES = [
  { description: '视频文件', accept: { 'video/*': ['.mp4', '.m4v', '.mov', '.mkv', '.webm'] } },
]

/** 本次打开页面期间已经选过的文件，按指纹索引。 */
const session = new Map<string, File>()

export interface Picked {
  file: File
  handle?: FileSystemFileHandle
}

function pickWithInput(): Promise<Picked | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'video/*,.mkv'
    input.onchange = () => resolve(input.files?.[0] ? { file: input.files[0] } : null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** 让用户选一个视频文件。支持的浏览器用系统文件选择器，这样能记住文件。 */
export async function pickVideoFile(): Promise<Picked | null> {
  const w = window as unknown as PickerWindow
  if (!w.showOpenFilePicker) return pickWithInput()
  try {
    const [handle] = await w.showOpenFilePicker({ types: VIDEO_TYPES })
    return { file: await handle.getFile(), handle }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    return pickWithInput()
  }
}

export async function rememberFile(fingerprint: string, picked: Picked) {
  session.set(fingerprint, picked.file)
  if (picked.handle) {
    await db.files.put({ fingerprint, name: picked.file.name, handle: picked.handle })
  }
}

/** 不需要用户操作就能拿到的文件：本次选过的，或者已经授权过的。 */
export async function getLocalFile(fingerprint: string): Promise<File | null> {
  const cached = session.get(fingerprint)
  if (cached) return cached
  const stored = await db.files.get(fingerprint)
  const handle = stored?.handle as PermissionedHandle | undefined
  if (handle && (await handle.queryPermission?.({ mode: 'read' })) === 'granted') {
    const file = await handle.getFile()
    session.set(fingerprint, file)
    return file
  }
  return null
}

/** 浏览器记得这个文件，但需要用户点一下重新授权。必须在点击事件里调用。 */
export async function restoreStoredFile(fingerprint: string): Promise<File | null> {
  const stored = await db.files.get(fingerprint)
  const handle = stored?.handle as PermissionedHandle | undefined
  if (!handle || (await handle.requestPermission?.({ mode: 'read' })) !== 'granted') return null
  const file = await handle.getFile()
  session.set(fingerprint, file)
  return file
}

export async function storedFileName(fingerprint: string): Promise<string | null> {
  return (await db.files.get(fingerprint))?.name ?? null
}

/** 让用户重新选文件，并核对是不是导入时的那个文件。 */
export async function bindFile(fingerprint: string): Promise<File | 'mismatch' | null> {
  const picked = await pickVideoFile()
  if (!picked) return null
  if ((await fileFingerprint(picked.file)) !== fingerprint) return 'mismatch'
  await rememberFile(fingerprint, picked)
  return picked.file
}
