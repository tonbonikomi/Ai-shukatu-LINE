import { env } from '@/lib/env'

/**
 * 運営への通知（docs/spec.md §4.8）
 *
 * 送り先は LINE の外（Slack）にしている。一柳から運営個人にプッシュで送ると
 * その分の通数を消費するため。
 */
export type OpsAlert = {
  title: string
  lines: string[]
  /** 運営が取るべき対応 */
  action?: string
}

export async function notifyOps(alert: OpsAlert): Promise<void> {
  const url = env.opsSlackWebhookUrl
  const body = [`*${alert.title}*`, ...alert.lines, alert.action ? `→ ${alert.action}` : null]
    .filter(Boolean)
    .join('\n')

  if (!url) {
    // 通知先が未設定でも本処理は止めない。ログには必ず残す
    console.warn('[ops] 通知先が未設定です\n%s', body)
    return
  }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: body }),
    })
  } catch (error) {
    // 通知の失敗で登録や入室検知そのものを落とさない
    console.error('[ops] 通知に失敗しました', error, body)
  }
}
