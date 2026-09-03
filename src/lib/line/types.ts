/** 扱う範囲の webhook イベント。LINE が送る全項目のうち、使うものだけを型にしている */

export type EventSource =
  | { type: 'user'; userId?: string }
  | { type: 'group'; groupId: string; userId?: string }
  | { type: 'room'; roomId: string; userId?: string }

export type LineWebhookEvent = {
  type: string
  source?: EventSource
  replyToken?: string
  timestamp?: number
  message?: { type: string; text?: string }
  joined?: { members: Array<{ type: string; userId: string }> }
  left?: { members: Array<{ type: string; userId: string }> }
  [key: string]: unknown
}

export type LineWebhookBody = { destination?: string; events?: LineWebhookEvent[] }
