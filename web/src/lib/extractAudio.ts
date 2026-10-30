import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  OggOutputFormat,
  Output,
  QUALITY_LOW,
} from 'mediabunny'

export class AudioExtractError extends Error {}

const DISCARD_REASONS: Record<string, string> = {
  unknown_source_codec: '无法识别这种编码',
  // 常见于 mkv 里的 AC-3 / DTS 音轨
  undecodable_source_codec: '浏览器没有这种编码的解码器',
  no_encodable_target_codec: '浏览器无法编码 Opus',
}

export async function probeDuration(file: File): Promise<number | null> {
  try {
    return await new Input({ source: new BlobSource(file), formats: ALL_FORMATS }).computeDuration()
  } catch {
    return null
  }
}

/**
 * 在浏览器里把视频的主音轨转成单声道 Opus（Ogg 封装），视频本身不离开设备。
 * 3 小时的电影大约几十 MB。
 */
export async function extractAudio(file: File, onProgress: (p: number) => void): Promise<Blob> {
  let input: Input
  try {
    input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    if (!(await input.getPrimaryAudioTrack())) throw new AudioExtractError('这个文件里没有找到音轨')
  } catch (e) {
    if (e instanceof AudioExtractError) throw e
    throw new AudioExtractError('浏览器无法读取这个文件的格式')
  }

  const output = new Output({ format: new OggOutputFormat(), target: new BufferTarget() })
  const conversion = await Conversion.init({
    input,
    output,
    tracks: 'primary',
    video: { discard: true },
    audio: { numberOfChannels: 1, codec: 'opus', quality: QUALITY_LOW },
    showWarnings: false,
  })
  if (!conversion.isValid) {
    // 视频轨是我们自己丢掉的（discarded_by_user），只看音轨的原因
    const audio = conversion.discardedTracks.find((d) => d.track.type === 'audio')
    const codec = audio?.track.codec ?? '未知'
    const reason = audio ? (DISCARD_REASONS[audio.reason] ?? audio.reason) : '没有可用的音轨'
    throw new AudioExtractError(
      `浏览器处理不了这个文件的音轨（编码：${codec}，${reason}）。` +
        `可以在终端用命令行导入，进度同样在片库里看：cd backend && uv run scene-english import "${file.name}"`,
    )
  }
  conversion.onProgress = onProgress
  await conversion.execute()
  const buffer = (output.target as BufferTarget).buffer
  if (!buffer) throw new AudioExtractError('音轨提取没有产出数据')
  return new Blob([buffer], { type: 'audio/ogg' })
}
