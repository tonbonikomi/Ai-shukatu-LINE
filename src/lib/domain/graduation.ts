import type { Grade } from './enums'

/**
 * 卒業年度の自動計算（docs/spec.md §4.3）
 *
 * 「28卒」は 2028年3月に卒業する人を指す。日本の年度は4月始まりなので、
 * 2027年度の学部4年生は 2028年3月に卒業して「28卒」になる。
 * つまり  卒年 = 年度 + 卒業までの残り年数  で、最終学年の残り年数は 1。
 *
 * サーバは UTC で動くため、年度の判定は必ず JST に直してから行う。
 * これをやらないと 3/31 と 4/1 の境界で1年ずれ、その日に登録した人が
 * まるごと違うグループに振り分けられる。
 */

/** JST に直したうえで年・月を取り出す（JST に夏時間は無いので固定9時間でよい） */
function jstParts(at: Date): { year: number; month: number } {
  const jst = new Date(at.getTime() + 9 * 60 * 60 * 1000)
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1 }
}

/** 年度。4月始まりなので、1〜3月は前年の年度になる */
export function academicYear(at: Date): number {
  const { year, month } = jstParts(at)
  return month >= 4 ? year : year - 1
}

/** 卒業までの残り年数。その年度の末に卒業するなら 1 */
const YEARS_TO_GRADUATION: Record<Grade, number | null> = {
  undergrad_1: 4,
  undergrad_2: 3,
  undergrad_3: 2,
  undergrad_4: 1,
  master_1: 2,
  master_2: 1,
  doctor: 1, // 年数が読めないので最終学年として扱う。本人に直してもらう前提
  other: null, // 推定しない
}

/**
 * 学年と現在時刻から卒業年度を推定する。
 * 推定できない場合は null を返し、呼び出し側が本人に選ばせる。
 */
export function estimateGraduationYear(grade: Grade, at: Date): number | null {
  const remaining = YEARS_TO_GRADUATION[grade]
  if (remaining === null) return null
  return academicYear(at) + remaining
}

/** 2028 → "28卒" */
export function graduationLabel(graduationYear: number): string {
  return `${String(graduationYear).slice(-2)}卒`
}
