import { describe, expect, it } from 'vitest'
import { isPlausibleBirthday, registrationSchema } from '@/lib/domain/validation'
import { generateInviteToken, inviteLinkFor } from '@/lib/domain/token'

const valid = {
  idToken: 'dummy.id.token',
  inviteToken: 'abc123',
  name: '田中太郎',
  nameKana: 'たなかたろう',
  university: 'A大学',
  grade: 'undergrad_3',
  birthday: '2005-04-01',
  region: 'kansai',
  graduationYear: 2028,
  graduationYearOverridden: false,
  privacyAgreed: true,
  groupOptIn: true,
}

describe('registrationSchema', () => {
  it('正しい入力を受け入れる', () => {
    expect(registrationSchema.safeParse(valid).success).toBe(true)
  })

  it('ふりがなはひらがなのみ', () => {
    expect(registrationSchema.safeParse({ ...valid, nameKana: 'タナカタロウ' }).success).toBe(false)
    expect(registrationSchema.safeParse({ ...valid, nameKana: '田中太郎' }).success).toBe(false)
    expect(registrationSchema.safeParse({ ...valid, nameKana: 'たなか たろう' }).success).toBe(true)
  })

  it('プライバシーポリシーへの同意は必須', () => {
    expect(registrationSchema.safeParse({ ...valid, privacyAgreed: false }).success).toBe(false)
  })

  it('グループへの招待は同意しなくても登録できる', () => {
    expect(registrationSchema.safeParse({ ...valid, groupOptIn: false }).success).toBe(true)
  })

  it('知らない学年・地域を弾く', () => {
    expect(registrationSchema.safeParse({ ...valid, grade: 'senior' }).success).toBe(false)
    expect(registrationSchema.safeParse({ ...valid, region: 'okinawa' }).success).toBe(false)
  })

  it('入口リンクのトークンが無ければ弾く', () => {
    expect(registrationSchema.safeParse({ ...valid, inviteToken: '' }).success).toBe(false)
  })

  it('前後の空白を落とす', () => {
    const parsed = registrationSchema.safeParse({ ...valid, name: '  田中太郎  ' })
    expect(parsed.success && parsed.data.name).toBe('田中太郎')
  })

  it('空の名前を弾く', () => {
    expect(registrationSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false)
  })
})

describe('isPlausibleBirthday', () => {
  const now = new Date('2026-09-03T00:00:00Z')

  it('学生としてありうる生年月日を受け入れる', () => {
    expect(isPlausibleBirthday('2005-04-01', now)).toBe(true)
    expect(isPlausibleBirthday('2000-12-31', now)).toBe(true)
  })

  it('明らかに若すぎる・古すぎる値を弾く', () => {
    expect(isPlausibleBirthday('2020-01-01', now)).toBe(false)
    expect(isPlausibleBirthday('1940-01-01', now)).toBe(false)
  })

  it('日付として壊れた値を弾く', () => {
    expect(isPlausibleBirthday('not-a-date', now)).toBe(false)
    expect(isPlausibleBirthday('', now)).toBe(false)
  })
})

describe('招待トークン', () => {
  it('URLセーフな22文字を返す', () => {
    const token = generateInviteToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })

  it('毎回違う値になる', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateInviteToken()))
    expect(tokens.size).toBe(500)
  })

  it('入口リンクを組み立てる', () => {
    expect(inviteLinkFor('2010483281-abcdefgh', 'tok_1')).toBe(
      'https://liff.line.me/2010483281-abcdefgh?t=tok_1',
    )
  })

  it('トークンをURLエスケープする', () => {
    expect(inviteLinkFor('L1', 'a+b/c=')).toBe('https://liff.line.me/L1?t=a%2Bb%2Fc%3D')
  })
})
