import Dexie, { type EntityTable } from 'dexie'

/** 学习进度先存在本地；阶段二再同步到服务器。 */
export interface SceneProgress {
  sceneId: number
  filmId: number
  step: number
  passed: boolean
  quizScore?: number
  updatedAt: number
}

export interface WordStatus {
  lemma: string
  known: boolean
}

/** 电脑版 Chrome / Edge 可以记住本地文件，下次不用重新选。 */
export interface StoredFile {
  fingerprint: string
  name: string
  handle: FileSystemFileHandle
}

export const db = new Dexie('scene-english') as Dexie & {
  progress: EntityTable<SceneProgress, 'sceneId'>
  words: EntityTable<WordStatus, 'lemma'>
  files: EntityTable<StoredFile, 'fingerprint'>
}

db.version(1).stores({
  progress: 'sceneId, filmId',
  words: 'lemma',
  files: 'fingerprint',
})

export async function saveStep(filmId: number, sceneId: number, step: number) {
  const prev = await db.progress.get(sceneId)
  await db.progress.put({
    sceneId,
    filmId,
    step: Math.max(step, prev?.step ?? 0),
    passed: prev?.passed ?? false,
    quizScore: prev?.quizScore,
    updatedAt: Date.now(),
  })
}

export async function savePassed(filmId: number, sceneId: number, quizScore: number) {
  await db.progress.put({ sceneId, filmId, step: 3, passed: true, quizScore, updatedAt: Date.now() })
}
