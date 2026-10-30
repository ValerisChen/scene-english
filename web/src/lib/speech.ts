let voice: SpeechSynthesisVoice | null = null

function pickVoice() {
  const voices = speechSynthesis.getVoices()
  voice =
    voices.find((v) => /en-US/i.test(v.lang) && /Samantha|Google US|Aria|Jenny/i.test(v.name)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null
}

if (typeof speechSynthesis !== 'undefined') {
  pickVoice()
  speechSynthesis.onvoiceschanged = pickVoice
}

/** 单词和例句的发音用系统朗读，免费；台词一律播放原片声音。 */
export function speak(text: string, rate = 0.9) {
  if (typeof speechSynthesis === 'undefined') return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  u.rate = rate
  if (voice) u.voice = voice
  speechSynthesis.speak(u)
}
