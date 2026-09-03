import { env } from '../env'

/**
 * LIFF の IDトークンを検証して LINEユーザーID を確定する（docs/spec.md §4.10）
 *
 * クライアントが送ってきた userId をそのまま信じてはいけない。
 * 信じると、他人の userId を名乗って登録を差し替えられる。
 * 必ずこの関数を通し、LINE に検証させた結果の sub を使う。
 */
export type VerifiedIdToken = { lineUserId: string; displayName: string | null }

export async function verifyIdToken(idToken: string): Promise<VerifiedIdToken | null> {
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: env.lineLoginChannelId }),
  })

  if (!res.ok) return null

  const payload = (await res.json()) as { sub?: string; name?: string; aud?: string }

  // aud がこちらのチャネルと一致しない＝別チャネル向けのトークン
  if (!payload.sub || payload.aud !== env.lineLoginChannelId) return null

  return { lineUserId: payload.sub, displayName: payload.name ?? null }
}
