import { env } from '../env'

const API = 'https://api.line.me/v2/bot'

export type TextMessage = { type: 'text'; text: string }

export const text = (body: string): TextMessage => ({ type: 'text', text: body })

async function call(path: string, payload: unknown): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.lineChannelAccessToken}`,
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`LINE API ${path} が ${res.status} を返しました: ${detail}`)
  }
}

/**
 * 応答メッセージ。**通数を消費しない。**
 * replyToken は1イベントにつき1回だけ、かつ発行から短時間で失効する。
 */
export function reply(replyToken: string, messages: TextMessage[]): Promise<void> {
  return call('/message/reply', { replyToken, messages })
}

/**
 * プッシュメッセージ。**宛先の人数分の通数を消費する。**
 * ユーザーの発言に返せる場面では reply を使うこと。
 */
export function push(to: string, messages: TextMessage[]): Promise<void> {
  return call('/message/push', { to, messages })
}
