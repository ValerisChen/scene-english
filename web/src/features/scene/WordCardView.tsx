import { useLiveQuery } from 'dexie-react-hooks'
import type { LineContent, WordCard } from '../../api/client'
import { SpeakerIcon } from '../../components/icons'
import { db } from '../../lib/db'
import { sceneLabel } from '../../lib/format'
import { splitHighlight } from '../../lib/markup'
import { usePlayer } from '../../lib/player'
import { speak } from '../../lib/speech'
import { ShadowButton } from './ShadowButton'

function Quote({ line, highlight }: { line: LineContent; highlight: string }) {
  const parts = splitHighlight(line.text, highlight)
  return (
    <p className="border-l-2 border-line pl-2.5 text-sm text-ink-2">
      <span className="mr-1.5 font-mono text-[11px] text-ink-3 uppercase">{line.speaker}</span>
      {parts ? (
        <>
          {parts[0]}
          <mark className="rounded-[3px] bg-accent-soft px-0.5 text-accent">{parts[1]}</mark>
          {parts[2]}
        </>
      ) : (
        line.text
      )}
    </p>
  )
}

/** 一个词的全部内容：释义、本片原句、搭配、例句，在一张卡里学完。 */
export function WordCardView({ word, line }: { word: WordCard; line: LineContent }) {
  const known = useLiveQuery(() => db.words.get(word.lemma), [word.lemma])?.known ?? false
  const toggleKnown = () => db.words.put({ lemma: word.lemma, known: !known })

  return (
    <article className="card grid gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-display text-[22px] font-bold">{word.text}</span>
        <span className="font-mono text-[13px] text-ink-3">{word.ipa}</span>
        <span className="text-xs text-ink-3 italic">{word.pos}</span>
      </div>
      <p>{word.zh}</p>
      <Quote line={line} highlight={word.highlight} />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-speak" onClick={() => speak(word.text)}>
          <SpeakerIcon />
          发音
        </button>
        <ShadowButton label="跟读" />
        <button className={`btn ${known ? 'border-transparent bg-good-soft text-good' : ''}`} onClick={toggleKnown}>
          {known ? '已掌握' : '标记为已掌握'}
        </button>
      </div>

      <div className="grid gap-4 border-t border-line pt-3 sm:grid-cols-[1fr_1.4fr]">
        <div className="grid content-start gap-1.5">
          <span className="text-xs tracking-wider text-ink-3">搭配</span>
          {word.collocations.map((c) => (
            <div key={c.text} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <b className="font-medium">{c.text}</b>
              <span className="text-sm text-ink-2">{c.zh}</span>
              {c.in_film && <span className="tag tag-accent">本片</span>}
            </div>
          ))}
        </div>
        <div className="grid content-start gap-1.5">
          <span className="text-xs tracking-wider text-ink-3">例句</span>
          {word.examples.map((ex) => (
            <div key={ex.en} className="grid gap-0.5 rounded-lg bg-surface-2 px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <span>{ex.en}</span>
                <button
                  className="grid shrink-0 place-items-center rounded-md p-0.5 text-speak [&_svg]:size-[18px]"
                  onClick={() => speak(ex.en)}
                  aria-label="朗读例句"
                >
                  <SpeakerIcon />
                </button>
              </div>
              <span className="text-[13px] text-ink-2">{ex.zh}</span>
              <span className={`tag mt-0.5 justify-self-start ${ex.source === 'film' ? 'tag-accent' : ''}`}>
                {ex.source === 'film' && ex.scene_seq ? `本片 · ${sceneLabel(ex.scene_seq)}` : 'AI 例句'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </article>
  )
}

/** 精听时点字幕里的词弹出的单词卡。 */
export function WordModal({ words, lines }: { words: WordCard[]; lines: LineContent[] }) {
  const { openWord, set } = usePlayer()
  if (openWord === null || !words[openWord]) return null
  const word = words[openWord]
  const close = () => set({ openWord: null })
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-[rgba(8,12,18,.55)] p-4"
      onClick={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === 'Escape' && close()}
    >
      <div role="dialog" aria-modal="true" aria-label="单词卡" className="grid max-h-full w-full max-w-xl gap-3 overflow-auto rounded-2xl bg-surface p-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">预习过的词</span>
          <button className="btn" onClick={close} autoFocus>
            关闭
          </button>
        </div>
        <WordCardView word={word} line={lines[word.line_idx]} />
      </div>
    </div>
  )
}
