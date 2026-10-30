import { describe, expect, it } from 'vitest'
import type { SceneSummary } from '../api/client'
import { lineAt } from '../features/scene/Player'
import { fileFingerprint } from './fingerprint'
import { clock, duration } from './format'
import { parseMarkup, plain, splitHighlight } from './markup'
import { comprehension, sceneStatuses } from './progress'

describe('fileFingerprint', () => {
  it('和后端 Python 算法结果一致', async () => {
    const data = new Uint8Array(256 * 1000).map((_, i) => i % 256)
    // backend: hashlib.sha256(d[:65536] + d[-65536:] + struct.pack(">d", float(len(d))))
    expect(await fileFingerprint(new Blob([data]))).toBe(
      'b06e717ee0ba6f7095175629161973db152537e91df86e54ff9ce3e4f3ea6a0a',
    )
  })
})

describe('markup', () => {
  const m = "If °you {gonna} do~it, {you'd_have} done~it."
  it('去掉记号后得到原台词', () => {
    expect(plain(m)).toBe("If you gonna do it, you'd have done it.")
  })
  it('拆出各类标注', () => {
    const kinds = parseMarkup(m).filter((s) => s.kind !== 'text')
    expect(kinds.map((s) => [s.kind, s.text])).toEqual([
      ['weak', 'you'],
      ['reduce', 'gonna'],
      ['link', '‿'],
      ['reduce', "you'd have"],
      ['link', '‿'],
    ])
    expect(parseMarkup(m).map((s) => s.text).join('').replace(/‿/g, ' ')).toBe(plain(m))
  })
  it('高亮不区分大小写', () => {
    expect(splitHighlight("I'll Let go.", 'let go')).toEqual(["I'll ", 'Let go', '.'])
    expect(splitHighlight('No!', 'let go')).toBeNull()
  })
})

describe('lineAt', () => {
  const lines = [0, 5, 10].map((s) => ({ start: s, end: s + 3, text: '', speaker: '', zh: '', markup: '', notes: [] }))
  it('两句之间的空档算前一句，场景外返回 null', () => {
    expect(lineAt(lines, 4)).toBe(0)
    expect(lineAt(lines, 5)).toBe(1)
    expect(lineAt(lines, 12.5)).toBe(2)
    expect(lineAt(lines, -5)).toBeNull()
    expect(lineAt(lines, 30)).toBeNull()
  })
})

describe('progress', () => {
  const scene = (id: number, start: number, words: number): SceneSummary => ({
    id, seq: id, start_ms: start * 1000, end_ms: (start + 100) * 1000, title_zh: '', title_en: '', summary_zh: '', word_count: words,
  })
  const scenes = [scene(1, 0, 30), scene(2, 100, 20), scene(3, 200, 10)]
  const done = (sceneId: number) => ({ sceneId, filmId: 1, step: 3, passed: true, updatedAt: 0 })

  it('没通关时听懂率为 0', () => {
    expect(comprehension(scenes, []).pct).toBe(0)
  })
  it('按通关场景的生词和时长估算', () => {
    const c = comprehension(scenes, [done(1)])
    expect(c.passed).toBe(1)
    expect(c.pct).toBe(Math.round(20 + (40 * 30) / 60 + (35 * 100) / 300))
  })
  it('第一个没通关的场景算学习中', () => {
    const s = sceneStatuses(scenes, [done(1)])
    expect([...s.values()]).toEqual(['passed', 'current', 'todo'])
  })
})

describe('format', () => {
  it('时间格式', () => {
    expect(clock(2484)).toBe('00:41:24')
    expect(duration(11640)).toBe('3h 14m')
  })
})
