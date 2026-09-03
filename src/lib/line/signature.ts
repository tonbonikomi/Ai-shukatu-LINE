import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * webhook の署名検証（docs/spec.md §4.10）
 *
 * これをやらないと、偽の「入室しました」を外部から送り込める。
 * 生のリクエストボディ（パース前の文字列）で検証すること。
 * JSON にしてから文字列化し直すと、キーの順序や空白が変わって一致しなくなる。
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null | undefined,
  channelSecret: string,
): boolean {
  if (!signature || !channelSecret) return false

  const expected = createHmac('sha256', channelSecret).update(rawBody, 'utf8').digest()

  let received: Buffer
  try {
    received = Buffer.from(signature, 'base64')
  } catch {
    return false
  }

  // timingSafeEqual は長さが違うと例外を投げるので先に弾く
  if (received.length !== expected.length) return false

  return timingSafeEqual(received, expected)
}
