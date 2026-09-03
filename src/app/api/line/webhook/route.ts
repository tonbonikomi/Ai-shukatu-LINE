import { NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { routeEvent } from '@/lib/line/routing'
import { verifyLineSignature } from '@/lib/line/signature'
import type { LineWebhookBody } from '@/lib/line/types'
import { reply } from '@/lib/line/client'
import {
  handleBotJoinedGroup,
  handleBotLeftGroup,
  handleMemberJoined,
  handleMemberLeft,
} from '@/server/joinEvents'
import { followGreeting } from '@/server/messages'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // 署名検証は必ず生のボディで行う。JSON にしてから戻すと一致しなくなる
  const rawBody = await request.text()

  if (!verifyLineSignature(rawBody, request.headers.get('x-line-signature'), env.lineChannelSecret)) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  let body: LineWebhookBody
  try {
    body = JSON.parse(rawBody) as LineWebhookBody
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  for (const event of body.events ?? []) {
    try {
      await handle(event)
    } catch (error) {
      // 1件の失敗で残りを止めない。LINE には 200 を返して再送を招かないようにする
      console.error('[webhook] イベントの処理に失敗しました', event.type, error)
    }
  }

  return NextResponse.json({ ok: true })
}

async function handle(event: Parameters<typeof routeEvent>[0]): Promise<void> {
  const action = routeEvent(event)

  switch (action.type) {
    case 'member_joined':
      await handleMemberJoined(action.groupId, action.lineUserIds, action.replyToken)
      return

    case 'member_left':
      await handleMemberLeft(action.groupId, action.lineUserIds)
      return

    case 'bot_joined_group':
      await handleBotJoinedGroup(action.groupId)
      return

    case 'bot_left_group':
      await handleBotLeftGroup(action.groupId)
      return

    case 'follow':
      await onFollow(action.lineUserId, action.replyToken)
      return

    case 'unfollow':
      await db()`
        update community.members set status = 'left' where line_user_id = ${action.lineUserId}
      `
      return

    case 'direct_message':
      // 応募キーワードの受付はここに実装する（応答なので通数は無料）
      // MVP では運営が手動で返すため、ログに残すだけにしている
      console.info('[line] 1対1メッセージ', action.lineUserId, action.text)
      return

    case 'group_message_ignored':
      // グループでは黙る。記録もしない（発言内容を保持しない方針）
      return

    case 'ignore':
      return
  }
}

/** 友だち追加。未登録なら登録画面を案内する（応答なので無料） */
async function onFollow(lineUserId: string, replyToken?: string): Promise<void> {
  if (!replyToken) return

  const [member] = await db()<Array<{ id: string }>>`
    select id from community.members where line_user_id = ${lineUserId}
  `
  if (member) return

  await reply(replyToken, [followGreeting()])
}
