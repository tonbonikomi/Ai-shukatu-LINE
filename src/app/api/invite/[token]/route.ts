import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 入口リンクのトークン検証（docs/spec.md §4.4）
 * 使用回数はここでは増やさない。増やすのは登録完了時。
 */
export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params

  const sql = db()
  const [row] = await sql<Array<{ reason: string; owner_member_id: string | null }>>`
    select reason, owner_member_id from community.check_invite_token(${token})
  `

  const reason = row?.reason ?? 'invalid'

  if (reason !== 'valid') {
    // どの理由でも、外に返す文言は同じにする（有効なトークンを総当たりで探させないため）
    return NextResponse.json({ valid: false, reason }, { status: 404 })
  }

  let referrerName: string | null = null
  if (row?.owner_member_id) {
    const [owner] = await sql<Array<{ name: string }>>`
      select name from community.members where id = ${row.owner_member_id}
    `
    referrerName = owner?.name ?? null
  }

  return NextResponse.json({ valid: true, referrerName })
}
