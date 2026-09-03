import { NextResponse } from 'next/server'
import { isPlausibleBirthday, registrationSchema } from '@/lib/domain/validation'
import { verifyIdToken } from '@/lib/liff/verify'
import { push } from '@/lib/line/client'
import { groupInvite, groupNotReady } from '@/server/messages'
import { notifyOps } from '@/server/notify'
import { register } from '@/server/registration'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const json = await request.json().catch(() => null)

  const parsed = registrationSchema.safeParse(json)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? '入力内容を確認してください'
    return NextResponse.json({ ok: false, message }, { status: 400 })
  }
  const input = parsed.data

  if (!isPlausibleBirthday(input.birthday, new Date())) {
    return NextResponse.json({ ok: false, message: '生年月日を確認してください' }, { status: 400 })
  }

  // クライアントが名乗った userId は信じない。LINE に検証させた結果だけを使う
  const identity = await verifyIdToken(input.idToken)
  if (!identity) {
    return NextResponse.json(
      { ok: false, message: 'ログイン情報を確認できませんでした。開き直してください' },
      { status: 401 },
    )
  }

  const result = await register(input, identity)

  if (result.status === 'token_rejected') {
    await notifyOps({
      title: '使えない入口リンクが使われました',
      lines: [`理由: ${result.reason}`, `ユーザーID: ${identity.lineUserId}`],
    })
    return NextResponse.json(
      { ok: false, message: 'このリンクは現在ご利用いただけません' },
      { status: 403 },
    )
  }

  // グループ招待リンクはプッシュで送る（1通消費）。レスポンスには含めない
  const message = result.groupInviteUrl
    ? groupInvite(input.name, result.groupInviteUrl)
    : groupNotReady(input.name)

  try {
    await push(identity.lineUserId, [message])
  } catch (error) {
    console.error('[line] 招待メッセージの送信に失敗しました', error)
    await notifyOps({
      title: '登録は完了したが招待メッセージを送れませんでした',
      lines: [`ユーザーID: ${identity.lineUserId}`, `お名前: ${input.name}`],
      action: '手動でグループ招待リンクを送ってください',
    })
  }

  if (!result.groupInviteUrl && input.groupOptIn) {
    await notifyOps({
      title: '振り分け先のグループがありません',
      lines: [
        `お名前: ${input.name}`,
        `卒年: ${input.graduationYear} / 地域: ${input.region}`,
      ],
      action: '該当するグループを作るか、「その他」グループに寄せてください',
    })
  }

  return NextResponse.json({
    ok: true,
    alreadyRegistered: result.status === 'already_registered',
    groupReady: result.groupInviteUrl !== null,
  })
}
