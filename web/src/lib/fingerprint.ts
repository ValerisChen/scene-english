const CHUNK = 64 * 1024

/**
 * 文件首尾各 64 KB 加上文件大小（big-endian float64），做 SHA-256。
 * 和后端 app/pipeline/fingerprint.py 的算法完全一致，不用读完整个几 GB 的文件。
 */
export async function fileFingerprint(file: Blob): Promise<string> {
  const head = await file.slice(0, CHUNK).arrayBuffer()
  const tail = await file.slice(Math.max(0, file.size - CHUNK)).arrayBuffer()
  const buf = new Uint8Array(head.byteLength + tail.byteLength + 8)
  buf.set(new Uint8Array(head), 0)
  buf.set(new Uint8Array(tail), head.byteLength)
  new DataView(buf.buffer).setFloat64(head.byteLength + tail.byteLength, file.size)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
