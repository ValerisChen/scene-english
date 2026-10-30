/**
 * 连读弱读标注语法（和后端 app/pipeline/markup.py 一致）：
 *   a~b 连读 · °w 弱读 · ^w 吞音/闪音 · {a_b} 缩略
 */
export type SegKind = 'text' | 'link' | 'weak' | 'drop' | 'reduce'
export interface Seg {
  kind: SegKind
  text: string
}

function part(p: string): Seg[] {
  if (p.startsWith('°')) return [{ kind: 'weak', text: p.slice(1) }]
  if (p.startsWith('^')) return [{ kind: 'drop', text: p.slice(1) }]
  const m = p.match(/^\{(.+?)\}(.*)$/)
  if (m) {
    const segs: Seg[] = [{ kind: 'reduce', text: m[1].replace(/_/g, ' ') }]
    if (m[2]) segs.push({ kind: 'text', text: m[2] })
    return segs
  }
  return [{ kind: 'text', text: p }]
}

export function parseMarkup(markup: string): Seg[] {
  const segs: Seg[] = []
  markup.split(' ').forEach((token, i) => {
    if (i > 0) segs.push({ kind: 'text', text: ' ' })
    token.split('~').forEach((p, j) => {
      if (j > 0) segs.push({ kind: 'link', text: '‿' })
      segs.push(...part(p))
    })
  })
  return segs
}

export const plain = (markup: string) => markup.replace(/[°^{}]/g, '').replace(/[~_]/g, ' ')

/** 在台词里找出要高亮的词组，返回 [前, 词, 后]；找不到时返回 null。 */
export function splitHighlight(text: string, highlight: string): [string, string, string] | null {
  const i = text.toLowerCase().indexOf(highlight.toLowerCase())
  if (i < 0 || !highlight) return null
  return [text.slice(0, i), text.slice(i, i + highlight.length), text.slice(i + highlight.length)]
}
