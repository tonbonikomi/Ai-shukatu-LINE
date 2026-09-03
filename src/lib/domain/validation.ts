import { z } from 'zod'
import { GRADES, REGIONS } from './enums'

/** 登録フォームの入力（docs/spec.md §4.3） */
export const registrationSchema = z.object({
  idToken: z.string().min(1, 'IDトークンがありません'),
  inviteToken: z.string().min(1, '入口リンクが正しくありません'),

  name: z.string().trim().min(1, 'お名前を入力してください').max(50, 'お名前が長すぎます'),
  nameKana: z
    .string()
    .trim()
    .min(1, 'ふりがなを入力してください')
    .max(50, 'ふりがなが長すぎます')
    .regex(/^[ぁ-んー゛゜\s　]+$/u, 'ふりがなは ひらがな で入力してください'),
  university: z.string().trim().min(1, '大学名を入力してください').max(100, '大学名が長すぎます'),
  grade: z.enum(GRADES, { message: '学年を選択してください' }),
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '生年月日を入力してください')
    .refine((v) => !Number.isNaN(Date.parse(v)), '生年月日が正しくありません'),
  region: z.enum(REGIONS, { message: '地域を選択してください' }),

  /** 学年から自動計算した値。本人が直した場合はその値が入る */
  graduationYear: z.number().int().min(2020).max(2040),
  graduationYearOverridden: z.boolean(),

  privacyAgreed: z.literal(true, { message: 'プライバシーポリシーへの同意が必要です' }),
  /** 「バイト案件を流すグループに招待してよいか」への同意（docs/spec.md §3-4） */
  groupOptIn: z.boolean(),
})

export type RegistrationInput = z.infer<typeof registrationSchema>

/**
 * 生年月日の妥当な範囲。
 * 入口では年齢を確認しない方針なので、ここは明らかな誤入力を弾くだけ。
 */
export function isPlausibleBirthday(birthday: string, now: Date): boolean {
  const value = Date.parse(birthday)
  if (Number.isNaN(value)) return false

  const oldest = Date.UTC(now.getUTCFullYear() - 60, 0, 1)
  const youngest = Date.UTC(now.getUTCFullYear() - 15, now.getUTCMonth(), now.getUTCDate())
  return value >= oldest && value <= youngest
}
