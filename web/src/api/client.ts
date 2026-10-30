import type { components } from './schema'

type S = components['schemas']
export type FilmDetail = S['FilmDetail']
export type Job = S['JobOut']
export type SceneSummary = S['SceneSummary']
export type Scene = S['SceneOut']
export type LineContent = S['LineContent']
export type WordCard = S['WordCard']
export type QuizQuestion = S['QuizQuestion']

const BASE = '/api'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body.detail === 'string') return body.detail
  } catch {
    // 响应不是 JSON
  }
  return `请求失败（${res.status}）`
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, init)
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return res.json() as Promise<T>
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  films: () => req<FilmDetail[]>('/films'),
  film: (id: number) => req<FilmDetail>(`/films/${id}`),
  async filmByFingerprint(fingerprint: string): Promise<FilmDetail | null> {
    try {
      return await req<FilmDetail>(`/films/by-fingerprint/${fingerprint}`)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null
      throw e
    }
  },
  createFilm: (body: S['FilmCreate']) => req<FilmDetail>('/films', json(body)),
  scenes: (filmId: number) => req<SceneSummary[]>(`/films/${filmId}/scenes`),
  scene: (id: number) => req<Scene>(`/scenes/${id}`),
  job: (id: number) => req<Job>(`/jobs/${id}`),

  /** 用 XHR 上传，fetch 拿不到上传进度。 */
  uploadAudio(filmId: number, audio: Blob, fileName: string, onProgress: (p: number) => void): Promise<Job> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const form = new FormData()
      form.append('file', audio, fileName)
      xhr.open('POST', `${BASE}/films/${filmId}/audio`)
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText))
        else reject(new ApiError(xhr.status, `上传失败（${xhr.status}）`))
      }
      xhr.onerror = () => reject(new ApiError(0, '网络错误，上传没有完成'))
      xhr.send(form)
    })
  },
}
