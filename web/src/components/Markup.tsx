import { parseMarkup } from '../lib/markup'

const CLASS = { text: '', link: 'cs-link', weak: 'cs-weak', drop: 'cs-drop', reduce: 'cs-reduce' }

/** 渲染带连读弱读标注的台词。 */
export function Markup({ markup }: { markup: string }) {
  return (
    <>
      {parseMarkup(markup).map((seg, i) =>
        seg.kind === 'text' ? (
          seg.text
        ) : (
          <span key={i} className={CLASS[seg.kind]} aria-label={seg.kind === 'link' ? '连读' : undefined}>
            {seg.text}
          </span>
        ),
      )}
    </>
  )
}

export function MarkupLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
      <span>
        <span className="cs-link">‿</span> 连读
      </span>
      <span>
        <span className="cs-weak">weak</span> 弱读
      </span>
      <span>
        <span className="cs-reduce">gonna</span> 缩略
      </span>
      <span>
        <span className="cs-drop">t</span> 吞音 / 闪音
      </span>
    </div>
  )
}
