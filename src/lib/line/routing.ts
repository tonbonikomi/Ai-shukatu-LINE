import type { LineWebhookEvent } from './types'

/**
 * webhook イベントの振り分け（docs/spec.md §4.6, §4.7）
 *
 * 最重要のルール: **グループの中では絶対に返信しない。**
 * グループ内の発言は全て webhook に届くので、うっかり応答すると場が死ぬ。
 * 唯一の例外が memberJoined への歓迎メッセージで、これは応答メッセージなので
 * 通数も消費しない。
 *
 * 判断をここに切り出してあるのは、この規則をテストで固定するため。
 */
export type WebhookAction =
  /** 1対1: 友だち追加 */
  | { type: 'follow'; lineUserId: string; replyToken?: string }
  /** 1対1: ブロック・削除 */
  | { type: 'unfollow'; lineUserId: string }
  /** 1対1: メッセージ（応募キーワードの受付。応答なので無料） */
  | { type: 'direct_message'; lineUserId: string; text: string; replyToken?: string }
  /** グループ内の発言。記録するだけで返信しない */
  | { type: 'group_message_ignored'; groupId: string }
  /** グループに人が入った */
  | { type: 'member_joined'; groupId: string; lineUserIds: string[]; replyToken?: string }
  /** グループから人が出た */
  | { type: 'member_left'; groupId: string; lineUserIds: string[] }
  /** 一柳自身がグループに追加された（台帳の groupId を埋める） */
  | { type: 'bot_joined_group'; groupId: string; replyToken?: string }
  /** 一柳自身がグループから外れた */
  | { type: 'bot_left_group'; groupId: string }
  /** 扱わないもの */
  | { type: 'ignore'; reason: string }

function groupIdOf(event: LineWebhookEvent): string | null {
  const source = event.source
  if (!source) return null
  if (source.type === 'group') return source.groupId
  if (source.type === 'room') return source.roomId
  return null
}

export function routeEvent(event: LineWebhookEvent): WebhookAction {
  const source = event.source
  if (!source) return { type: 'ignore', reason: 'source が無い' }

  const groupId = groupIdOf(event)
  const inGroup = groupId !== null

  switch (event.type) {
    case 'memberJoined': {
      if (!inGroup) return { type: 'ignore', reason: 'グループ外の memberJoined' }
      const ids = (event.joined?.members ?? []).map((m) => m.userId).filter(Boolean)
      return { type: 'member_joined', groupId, lineUserIds: ids, replyToken: event.replyToken }
    }

    case 'memberLeft': {
      if (!inGroup) return { type: 'ignore', reason: 'グループ外の memberLeft' }
      const ids = (event.left?.members ?? []).map((m) => m.userId).filter(Boolean)
      return { type: 'member_left', groupId, lineUserIds: ids }
    }

    case 'join':
      if (!inGroup) return { type: 'ignore', reason: 'グループ外の join' }
      return { type: 'bot_joined_group', groupId, replyToken: event.replyToken }

    case 'leave':
      if (!inGroup) return { type: 'ignore', reason: 'グループ外の leave' }
      return { type: 'bot_left_group', groupId }

    case 'message': {
      // グループ内の発言には絶対に返信しない
      if (inGroup) return { type: 'group_message_ignored', groupId }

      if (source.type !== 'user' || !source.userId) {
        return { type: 'ignore', reason: 'userId が無いメッセージ' }
      }
      if (event.message?.type !== 'text' || typeof event.message.text !== 'string') {
        return { type: 'ignore', reason: 'テキスト以外のメッセージ' }
      }
      return {
        type: 'direct_message',
        lineUserId: source.userId,
        text: event.message.text,
        replyToken: event.replyToken,
      }
    }

    case 'follow':
      if (inGroup || source.type !== 'user' || !source.userId) {
        return { type: 'ignore', reason: 'userId が無い follow' }
      }
      return { type: 'follow', lineUserId: source.userId, replyToken: event.replyToken }

    case 'unfollow':
      if (inGroup || source.type !== 'user' || !source.userId) {
        return { type: 'ignore', reason: 'userId が無い unfollow' }
      }
      return { type: 'unfollow', lineUserId: source.userId }

    default:
      return { type: 'ignore', reason: `扱わないイベント: ${event.type}` }
  }
}

/** そのイベントに対して一柳が発言してよいか。グループでは memberJoined の歓迎だけ */
export function mayReply(action: WebhookAction): boolean {
  switch (action.type) {
    case 'follow':
    case 'direct_message':
    case 'member_joined':
    case 'bot_joined_group':
      return true
    default:
      return false
  }
}
