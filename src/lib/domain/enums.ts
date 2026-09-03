/** 地域。グループの振り分けに使う（docs/spec.md §4.3） */
export const REGIONS = ['kansai', 'kanto', 'nagoya', 'kyushu', 'tohoku', 'other'] as const
export type Region = (typeof REGIONS)[number]

export const REGION_LABELS: Record<Region, string> = {
  kansai: '関西',
  kanto: '関東',
  nagoya: '名古屋',
  kyushu: '九州',
  tohoku: '東北',
  other: 'その他',
}

/** 学年。卒業年度の自動計算に使う */
export const GRADES = [
  'undergrad_1',
  'undergrad_2',
  'undergrad_3',
  'undergrad_4',
  'master_1',
  'master_2',
  'doctor',
  'other',
] as const
export type Grade = (typeof GRADES)[number]

export const GRADE_LABELS: Record<Grade, string> = {
  undergrad_1: '学部1年',
  undergrad_2: '学部2年',
  undergrad_3: '学部3年',
  undergrad_4: '学部4年',
  master_1: '修士1年',
  master_2: '修士2年',
  doctor: '博士',
  other: 'その他',
}
