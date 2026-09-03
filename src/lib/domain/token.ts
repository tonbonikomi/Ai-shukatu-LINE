import { randomBytes } from 'node:crypto'

/**
 * 招待トークン（docs/spec.md §4.4）
 *
 * 連番や推測できる値にしないこと。入口リンクは配布物なので、
 * 1つ漏れたときに隣の値を試されると芋づるに開く。
 */
export function generateInviteToken(): string {
  return randomBytes(16).toString('base64url') // 128bit → 22文字のURLセーフ文字列
}

/** 入口リンク。LIFF直リンク（docs/decisions.md D-004） */
export function inviteLinkFor(liffId: string, token: string): string {
  return `https://liff.line.me/${liffId}?t=${encodeURIComponent(token)}`
}
