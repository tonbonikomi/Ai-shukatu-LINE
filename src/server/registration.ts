import type { TransactionSql } from 'postgres'
import { db, isUniqueViolation } from '@/lib/db'
import { env } from '@/lib/env'
import type { RegistrationInput } from '@/lib/domain/validation'

/**
 * 登録処理（docs/spec.md §4.2, §4.4, §4.5）
 *
 * トークンの検証・登録・使用回数の加算・グループの振り分けを1つのトランザクションで行う。
 * 分けると、使用上限ちょうどの2人が同時に登録したときに両方通ってしまう。
 */
export type RegistrationResult =
  | { status: 'registered'; memberId: string; groupInviteUrl: string | null }
  | { status: 'already_registered'; memberId: string; groupInviteUrl: string | null }
  | { status: 'token_rejected'; reason: 'invalid' | 'revoked' | 'expired' | 'exhausted' }

type TokenRow = { reason: string; token_id: string | null; owner_member_id: string | null }

export async function register(
  input: RegistrationInput,
  identity: { lineUserId: string; displayName: string | null },
): Promise<RegistrationResult> {
  const sql = db()

  return sql.begin(async (tx) => {
    // 使用回数の判定と加算の間に他のトランザクションが割り込まないよう行を押さえる
    const [locked] = await tx<Array<{ id: string }>>`
      select id from community.invite_tokens
       where token = ${input.inviteToken}
       for update
    `

    const [token] = await tx<TokenRow[]>`
      select * from community.check_invite_token(${input.inviteToken})
    `

    if (!token || token.reason !== 'valid') {
      const reason = (token?.reason ?? 'invalid') as 'invalid' | 'revoked' | 'expired' | 'exhausted'
      return { status: 'token_rejected', reason }
    }
    void locked

    // 既に登録済みなら、その人の現在の招待先を返して終わる
    const [existing] = await tx<Array<{ id: string }>>`
      select id from community.members where line_user_id = ${identity.lineUserId}
    `
    if (existing) {
      return {
        status: 'already_registered',
        memberId: existing.id,
        groupInviteUrl: await currentInviteUrl(tx, existing.id),
      }
    }

    let memberId: string
    try {
      const [member] = await tx<Array<{ id: string }>>`
        insert into community.members (
          line_user_id, display_name, name, name_kana, university, grade, birthday,
          graduation_year, graduation_year_overridden, region,
          referrer_member_id, invite_token_id,
          privacy_agreed_at, privacy_version, group_opt_in_at
        ) values (
          ${identity.lineUserId}, ${identity.displayName}, ${input.name}, ${input.nameKana},
          ${input.university}, ${input.grade}, ${input.birthday},
          ${input.graduationYear}, ${input.graduationYearOverridden}, ${input.region},
          ${token.owner_member_id}, ${token.token_id},
          now(), ${env.privacyPolicyVersion}, ${input.groupOptIn ? sql`now()` : null}
        )
        returning id
      `
      if (!member) throw new Error('登録に失敗しました')
      memberId = member.id
    } catch (error) {
      // 同じ人が二重に送信した場合。unique 制約で弾かれるので既存を返す
      if (isUniqueViolation(error)) {
        const [row] = await tx<Array<{ id: string }>>`
          select id from community.members where line_user_id = ${identity.lineUserId}
        `
        if (row) {
          return {
            status: 'already_registered',
            memberId: row.id,
            groupInviteUrl: await currentInviteUrl(tx, row.id),
          }
        }
      }
      throw error
    }

    // 使用回数は登録完了時にだけ加算する（LIFF を開いただけでは消費させない）
    await tx`
      update community.invite_tokens
         set used_count = used_count + 1
       where id = ${token.token_id}
    `

    // グループに入る同意が無ければ振り分けない
    if (!input.groupOptIn) {
      return { status: 'registered', memberId, groupInviteUrl: null }
    }

    const [group] = await tx<Array<{ id: string; invite_url: string | null }>>`
      select g.id, g.invite_url
        from community.find_open_group(${input.graduationYear}, ${input.region}) as f(id)
        join community.line_groups g on g.id = f.id
    `

    if (!group?.invite_url) {
      return { status: 'registered', memberId, groupInviteUrl: null }
    }

    await tx`
      insert into community.group_memberships (member_id, group_id, state, source)
      values (${memberId}, ${group.id}, 'invited', 'auto_invite')
      on conflict (member_id, group_id) do nothing
    `

    return { status: 'registered', memberId, groupInviteUrl: group.invite_url }
  })
}

/** その人が招待済み・入室済みのグループの招待URL */
async function currentInviteUrl(
  tx: TransactionSql,
  memberId: string,
): Promise<string | null> {
  const [row] = await tx<Array<{ invite_url: string | null }>>`
    select g.invite_url
      from community.group_memberships m
      join community.line_groups g on g.id = m.group_id
     where m.member_id = ${memberId}
       and m.state in ('invited', 'joined')
     order by m.invited_at desc
     limit 1
  `
  return row?.invite_url ?? null
}
