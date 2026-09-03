import { describe, expect, it } from 'vitest'
import { mayReply, routeEvent } from '@/lib/line/routing'
import type { LineWebhookEvent } from '@/lib/line/types'

const groupSource = { type: 'group' as const, groupId: 'G1', userId: 'U1' }
const userSource = { type: 'user' as const, userId: 'U1' }

describe('グループでは黙る', () => {
  it('グループ内のメッセージには返信しない', () => {
    const event: LineWebhookEvent = {
      type: 'message',
      source: groupSource,
      replyToken: 'RT',
      message: { type: 'text', text: '案件ありますか？' },
    }
    const action = routeEvent(event)
    expect(action).toEqual({ type: 'group_message_ignored', groupId: 'G1' })
    expect(mayReply(action)).toBe(false)
  })

  it('複数人トーク（room）でも返信しない', () => {
    const action = routeEvent({
      type: 'message',
      source: { type: 'room', roomId: 'R1', userId: 'U1' },
      replyToken: 'RT',
      message: { type: 'text', text: 'こんにちは' },
    })
    expect(action).toEqual({ type: 'group_message_ignored', groupId: 'R1' })
    expect(mayReply(action)).toBe(false)
  })

  it('グループで返信してよいのは入室時の歓迎だけ', () => {
    const joined = routeEvent({
      type: 'memberJoined',
      source: groupSource,
      replyToken: 'RT',
      joined: { members: [{ type: 'user', userId: 'U_new' }] },
    })
    expect(mayReply(joined)).toBe(true)

    const left = routeEvent({
      type: 'memberLeft',
      source: groupSource,
      left: { members: [{ type: 'user', userId: 'U_gone' }] },
    })
    expect(mayReply(left)).toBe(false)
  })
})

describe('memberJoined / memberLeft', () => {
  it('入室した全員の userId を取り出す', () => {
    expect(
      routeEvent({
        type: 'memberJoined',
        source: groupSource,
        replyToken: 'RT',
        joined: { members: [{ type: 'user', userId: 'U_a' }, { type: 'user', userId: 'U_b' }] },
      }),
    ).toEqual({ type: 'member_joined', groupId: 'G1', lineUserIds: ['U_a', 'U_b'], replyToken: 'RT' })
  })

  it('members が空でも壊れない', () => {
    expect(
      routeEvent({ type: 'memberJoined', source: groupSource, joined: { members: [] } }),
    ).toEqual({ type: 'member_joined', groupId: 'G1', lineUserIds: [], replyToken: undefined })
  })

  it('members が欠けていても壊れない', () => {
    const action = routeEvent({ type: 'memberJoined', source: groupSource })
    expect(action).toMatchObject({ type: 'member_joined', lineUserIds: [] })
  })

  it('退室した全員の userId を取り出す', () => {
    expect(
      routeEvent({
        type: 'memberLeft',
        source: groupSource,
        left: { members: [{ type: 'user', userId: 'U_a' }] },
      }),
    ).toEqual({ type: 'member_left', groupId: 'G1', lineUserIds: ['U_a'] })
  })
})

describe('1対1', () => {
  it('テキストメッセージは応募キーワードとして受け付ける', () => {
    expect(
      routeEvent({
        type: 'message',
        source: userSource,
        replyToken: 'RT',
        message: { type: 'text', text: '0904大阪' },
      }),
    ).toEqual({ type: 'direct_message', lineUserId: 'U1', text: '0904大阪', replyToken: 'RT' })
  })

  it('テキスト以外（スタンプ・画像）は扱わない', () => {
    expect(routeEvent({ type: 'message', source: userSource, message: { type: 'sticker' } }))
      .toMatchObject({ type: 'ignore' })
  })

  it('友だち追加とブロックを拾う', () => {
    expect(routeEvent({ type: 'follow', source: userSource, replyToken: 'RT' }))
      .toEqual({ type: 'follow', lineUserId: 'U1', replyToken: 'RT' })
    expect(routeEvent({ type: 'unfollow', source: userSource }))
      .toEqual({ type: 'unfollow', lineUserId: 'U1' })
  })
})

describe('一柳自身の入退室', () => {
  it('グループに追加されたら台帳を埋めるために拾う', () => {
    expect(routeEvent({ type: 'join', source: groupSource, replyToken: 'RT' }))
      .toEqual({ type: 'bot_joined_group', groupId: 'G1', replyToken: 'RT' })
  })

  it('グループから外れたら拾う', () => {
    expect(routeEvent({ type: 'leave', source: groupSource }))
      .toEqual({ type: 'bot_left_group', groupId: 'G1' })
  })
})

describe('壊れた入力', () => {
  it('source が無ければ無視する', () => {
    expect(routeEvent({ type: 'message' })).toMatchObject({ type: 'ignore' })
  })

  it('userId の無い1対1メッセージは無視する', () => {
    expect(routeEvent({ type: 'message', source: { type: 'user' }, message: { type: 'text', text: 'a' } }))
      .toMatchObject({ type: 'ignore' })
  })

  it('知らないイベント種別は無視する', () => {
    expect(routeEvent({ type: 'videoPlayComplete', source: userSource }))
      .toMatchObject({ type: 'ignore' })
  })

  it('無視するイベントには返信しない', () => {
    expect(mayReply({ type: 'ignore', reason: 'x' })).toBe(false)
  })
})
