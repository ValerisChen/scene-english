import type { SceneSummary } from '../api/client'
import type { SceneProgress } from './db'

export type SceneStatus = 'passed' | 'current' | 'todo'

/**
 * 预估听懂率：按已通关场景的生词占比和时长占比估算（需求文档里这项还没定，先沿用演示的算法）。
 */
export function comprehension(scenes: SceneSummary[], progress: SceneProgress[]) {
  const passed = new Set(progress.filter((p) => p.passed).map((p) => p.sceneId))
  const totalWords = scenes.reduce((s, x) => s + x.word_count, 0) || 1
  const totalMs = scenes.reduce((s, x) => s + (x.end_ms - x.start_ms), 0) || 1
  let words = 0
  let ms = 0
  for (const s of scenes) {
    if (passed.has(s.id)) {
      words += s.word_count
      ms += s.end_ms - s.start_ms
    }
  }
  return {
    pct: passed.size ? Math.round(20 + (40 * words) / totalWords + (35 * ms) / totalMs) : 0,
    passed: passed.size,
    words,
    leftSec: (totalMs - ms) / 1000,
  }
}

/** 已通关的算通关；第一个没通关的场景算"学习中"，其余是"未开始"。 */
export function sceneStatuses(scenes: SceneSummary[], progress: SceneProgress[]): Map<number, SceneStatus> {
  const byId = new Map(progress.map((p) => [p.sceneId, p]))
  const out = new Map<number, SceneStatus>()
  let currentAssigned = false
  for (const s of scenes) {
    if (byId.get(s.id)?.passed) out.set(s.id, 'passed')
    else if (!currentAssigned) {
      out.set(s.id, 'current')
      currentAssigned = true
    } else out.set(s.id, byId.has(s.id) ? 'current' : 'todo')
  }
  return out
}
