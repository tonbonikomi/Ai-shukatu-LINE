import { describe, expect, it } from 'vitest'
import { academicYear, estimateGraduationYear, graduationLabel } from '@/lib/domain/graduation'

/** JST の日時を Date にする */
const jst = (iso: string) => new Date(`${iso}+09:00`)

describe('academicYear — 年度は4月始まり', () => {
  it('4月から12月はその年', () => {
    expect(academicYear(jst('2026-04-01T00:00:00'))).toBe(2026)
    expect(academicYear(jst('2026-09-03T12:00:00'))).toBe(2026)
    expect(academicYear(jst('2026-12-31T23:59:59'))).toBe(2026)
  })

  it('1月から3月は前年の年度', () => {
    expect(academicYear(jst('2027-01-01T00:00:00'))).toBe(2026)
    expect(academicYear(jst('2027-03-31T23:59:59'))).toBe(2026)
  })

  it('年度の境界を JST で判定する（UTC で判定すると1年ずれる）', () => {
    // 2027-03-31T15:00Z = 2027-04-01T00:00 JST
    expect(academicYear(new Date('2027-03-31T15:00:00Z'))).toBe(2027)
    // その1秒前はまだ 2026年度
    expect(academicYear(new Date('2027-03-31T14:59:59Z'))).toBe(2026)
  })
})

describe('estimateGraduationYear', () => {
  it('最終学年は年度の翌年に卒業する', () => {
    // 2026年度の学部4年は 2027年3月に卒業 → 27卒
    expect(estimateGraduationYear('undergrad_4', jst('2026-09-03T12:00:00'))).toBe(2027)
    expect(estimateGraduationYear('master_2', jst('2026-09-03T12:00:00'))).toBe(2027)
  })

  it('学年ごとに残り年数を足す', () => {
    const now = jst('2026-09-03T12:00:00') // 2026年度
    expect(estimateGraduationYear('undergrad_1', now)).toBe(2030)
    expect(estimateGraduationYear('undergrad_2', now)).toBe(2029)
    expect(estimateGraduationYear('undergrad_3', now)).toBe(2028)
    expect(estimateGraduationYear('undergrad_4', now)).toBe(2027)
    expect(estimateGraduationYear('master_1', now)).toBe(2028)
    expect(estimateGraduationYear('master_2', now)).toBe(2027)
  })

  it('年度をまたぐと1つ繰り上がる', () => {
    // 3月31日の学部3年は 2026年度なので 28卒
    expect(estimateGraduationYear('undergrad_3', jst('2027-03-31T23:59:59'))).toBe(2028)
    // 翌日は 2027年度に入るので 29卒
    expect(estimateGraduationYear('undergrad_3', jst('2027-04-01T00:00:00'))).toBe(2029)
  })

  it('「その他」は推定しない（本人に選ばせる）', () => {
    expect(estimateGraduationYear('other', jst('2026-09-03T12:00:00'))).toBeNull()
  })

  it('博士は最終学年として扱う', () => {
    expect(estimateGraduationYear('doctor', jst('2026-09-03T12:00:00'))).toBe(2027)
  })
})

describe('graduationLabel', () => {
  it('下2桁に「卒」を付ける', () => {
    expect(graduationLabel(2028)).toBe('28卒')
    expect(graduationLabel(2030)).toBe('30卒')
  })
})
