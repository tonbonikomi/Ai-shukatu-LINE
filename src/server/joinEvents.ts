import { db } from '@/lib/db'
import { generateInviteToken, inviteLinkFor } from '@/lib/domain/token'
import { push, reply } from '@/lib/line/client'
import { askToRegister, welcomeToGroup } from './messages'
import { notifyOps } from './notify'

/**
 * 入室・退室の検知（docs/spec.md §4.7）
 *
 * botはメンバーを退出させられないので、ここでできるのは検知と通知まで。
 * 退出の操作は運営の業務用アカウントから手動で行う。
 */

/** 未登録者への登録依頼の猶予期間（docs/decisions.md D-002） */
const GRACE_PERIOD_DAYS = Number(process.env.REGISTRATION_GRACE_DAYS ?? 3)

export async function handleMemberJoined(
  lineGroupId: string,
  lineUserIds: string[],
  replyToken?: string,
): Promise<void> {
  const sql = db()

  const [group] = await sql<Array<{ id: string; name: string }>>`
    select id, name from community.line_groups where line_group_id = ${lineGroupId}
  `

  for (const lineUserId of lineUserIds) {
    const [member] = await sql<Array<{ id: string; name: string }>>`
      select id, name from community.members where line_user_id = ${lineUserId}
    `

    await sql`
      insert into community.group_join_events
        (line_group_id, line_user_id, event_type, matched_member_id, resolution, raw)
      values (
        ${lineGroupId}, ${lineUserId}, 'joined', ${member?.id ?? null},
        ${member ? 'matched' : 'unknown_notified'},
        ${sql.json({ lineGroupId, lineUserId })}
      )
    `

    if (!group) {
      // 台帳に無いグループ。一柳が招待された直後などに起こりうる
      await notifyOps({
        title: '台帳にないグループで入室を検知しました',
        lines: [`グループID: ${lineGroupId}`, `ユーザーID: ${lineUserId}`],
        action: 'line_groups に該当グループを登録してください',
      })
      continue
    }

    if (member) {
      await sql`
        insert into community.group_memberships (member_id, group_id, state, source, joined_at)
        values (${member.id}, ${group.id}, 'joined', 'auto_invite', now())
        on conflict (member_id, group_id)
          do update set state = 'joined', joined_at = now()
      `
      await sql`
        update community.members set status = 'joined_group' where id = ${member.id}
      `
    } else {
      await handleUnknownJoin(lineGroupId, lineUserId, group.name)
    }
  }

  if (group) {
    await sql`select community.recalc_group_member_count(${group.id})`
    await warnIfNearlyFull(group.id, group.name)
  }

  // 応答メッセージなので通数を消費しない。ルール掲示を兼ねる
  if (replyToken) {
    await reply(replyToken, [welcomeToGroup()]).catch((error) =>
      console.error('[line] 歓迎メッセージの送信に失敗しました', error),
    )
  }
}

/**
 * 招待リンクを踏まずに入ってきた人（docs/decisions.md D-002）
 *
 * 登録を依頼し、応じなければ運営が退出させる。
 * その人専用の使い捨てトークンを発行して渡すので、
 * 登録は通るが紹介者は不明のまま（referrer_member_id = null）になる。
 */
async function handleUnknownJoin(
  lineGroupId: string,
  lineUserId: string,
  groupName: string,
): Promise<void> {
  const sql = db()
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID

  let registrationUrl: string | null = null
  if (liffId) {
    const token = generateInviteToken()
    await sql`
      insert into community.invite_tokens (token, label, max_uses, expires_at, created_by)
      values (
        ${token},
        ${`未登録入室: ${groupName}`},
        1,
        now() + ${`${GRACE_PERIOD_DAYS} days`}::interval,
        'system:member_joined'
      )
    `
    registrationUrl = inviteLinkFor(liffId, token)
  }

  await notifyOps({
    title: '未登録の人がグループに入りました',
    lines: [
      `グループ: ${groupName}`,
      `ユーザーID: ${lineUserId}`,
      `猶予: ${GRACE_PERIOD_DAYS}日`,
    ],
    action: `登録を依頼済み。${GRACE_PERIOD_DAYS}日以内に登録されなければ、業務用アカウントから退出させてください`,
  })

  if (registrationUrl) {
    // プッシュなので1通課金される。リマインドはしない（運用ルール）
    await push(lineUserId, [askToRegister(registrationUrl)]).catch((error) =>
      console.error('[line] 登録依頼の送信に失敗しました', error),
    )
  }
}

export async function handleMemberLeft(lineGroupId: string, lineUserIds: string[]): Promise<void> {
  const sql = db()

  const [group] = await sql<Array<{ id: string }>>`
    select id from community.line_groups where line_group_id = ${lineGroupId}
  `

  for (const lineUserId of lineUserIds) {
    const [member] = await sql<Array<{ id: string }>>`
      select id from community.members where line_user_id = ${lineUserId}
    `

    await sql`
      insert into community.group_join_events
        (line_group_id, line_user_id, event_type, matched_member_id, resolution, raw)
      values (
        ${lineGroupId}, ${lineUserId}, 'left', ${member?.id ?? null},
        ${member ? 'matched' : 'unknown_notified'},
        ${sql.json({ lineGroupId, lineUserId })}
      )
    `

    if (member && group) {
      await sql`
        update community.group_memberships
           set state = 'left', left_at = now()
         where member_id = ${member.id} and group_id = ${group.id}
      `
    }
  }

  if (group) await sql`select community.recalc_group_member_count(${group.id})`
}

/** 一柳がグループに追加されたら、台帳の groupId を埋める */
export async function handleBotJoinedGroup(lineGroupId: string): Promise<void> {
  const sql = db()

  const [existing] = await sql<Array<{ id: string }>>`
    select id from community.line_groups where line_group_id = ${lineGroupId}
  `
  if (existing) return

  // 準備中のグループが1つだけなら、それに紐づける
  const pending = await sql<Array<{ id: string; name: string }>>`
    select id, name from community.line_groups
     where line_group_id is null and status = 'preparing'
     order by created_at
  `

  if (pending.length === 1 && pending[0]) {
    await sql`
      update community.line_groups
         set line_group_id = ${lineGroupId}
       where id = ${pending[0].id}
    `
    await notifyOps({
      title: 'グループに一柳が入りました',
      lines: [`グループ: ${pending[0].name}`, `グループID: ${lineGroupId}`],
      action: '招待URLを台帳に登録し、status を open にすると振り分けが始まります',
    })
    return
  }

  // 候補が複数あるときは自動で決めない
  await notifyOps({
    title: '一柳が知らないグループに追加されました',
    lines: [`グループID: ${lineGroupId}`, `準備中のグループ: ${pending.length}件`],
    action: 'line_groups のどのグループか手動で紐づけてください',
  })
}

export async function handleBotLeftGroup(lineGroupId: string): Promise<void> {
  const sql = db()
  await sql`
    update community.line_groups set status = 'closed' where line_group_id = ${lineGroupId}
  `
  await notifyOps({
    title: '一柳がグループから外れました',
    lines: [`グループID: ${lineGroupId}`],
    action: '意図しない退出であれば、招待し直してください',
  })
}

/** 定員が近づいたら知らせる（docs/operations.md シナリオD） */
async function warnIfNearlyFull(groupId: string, groupName: string): Promise<void> {
  const sql = db()
  const [group] = await sql<Array<{ member_count: number; capacity: number; status: string }>>`
    select member_count, capacity, status from community.line_groups where id = ${groupId}
  `
  if (!group) return

  const threshold = Math.floor(group.capacity * 0.9)
  if (group.member_count < threshold) return

  await notifyOps({
    title: group.status === 'full' ? 'グループが定員に達しました' : 'グループの定員が近づいています',
    lines: [`グループ: ${groupName}`, `人数: ${group.member_count} / ${group.capacity}`],
    action: '次のグループを作成し、一柳を招待して台帳に登録してください',
  })
}
