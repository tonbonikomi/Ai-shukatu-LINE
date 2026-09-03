'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { GRADES, GRADE_LABELS, REGIONS, REGION_LABELS } from '@/lib/domain/enums'
import type { Grade, Region } from '@/lib/domain/enums'
import { estimateGraduationYear, graduationLabel } from '@/lib/domain/graduation'

type Phase = 'loading' | 'need_friend' | 'bad_token' | 'form' | 'submitting' | 'done'

export default function RegisterForm() {
  const params = useSearchParams()
  const inviteToken = params.get('t') ?? ''

  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState<string | null>(null)
  const [idToken, setIdToken] = useState('')
  const [groupReady, setGroupReady] = useState(true)

  const [name, setName] = useState('')
  const [nameKana, setNameKana] = useState('')
  const [university, setUniversity] = useState('')
  const [grade, setGrade] = useState<Grade | ''>('')
  const [birthday, setBirthday] = useState('')
  const [region, setRegion] = useState<Region | ''>('')
  const [graduationYear, setGraduationYear] = useState<number | null>(null)
  const [overridden, setOverridden] = useState(false)
  const [privacyAgreed, setPrivacyAgreed] = useState(false)
  const [groupOptIn, setGroupOptIn] = useState(true)

  // 学年を選んだら卒業年度を推定する。本人が直したらそれを優先する
  useEffect(() => {
    if (!grade || overridden) return
    setGraduationYear(estimateGraduationYear(grade, new Date()))
  }, [grade, overridden])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      if (!inviteToken) {
        setPhase('bad_token')
        return
      }

      try {
        const liff = (await import('@line/liff')).default
        await liff.init({ liffId: process.env.NEXT_PUBLIC_LIFF_ID ?? '' })

        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href })
          return
        }

        // 一柳を友だち追加していない人は登録させない。ここが「実質の関所」
        const friendship = await liff.getFriendship()
        if (!friendship.friendFlag) {
          if (!cancelled) setPhase('need_friend')
          return
        }

        const token = liff.getIDToken()
        if (!token) {
          if (!cancelled) setError('ログイン情報を取得できませんでした。開き直してください')
          return
        }

        const res = await fetch(`/api/invite/${encodeURIComponent(inviteToken)}`)
        if (!res.ok) {
          if (!cancelled) setPhase('bad_token')
          return
        }

        if (!cancelled) {
          setIdToken(token)
          setPhase('form')
        }
      } catch {
        if (!cancelled) setError('読み込みに失敗しました。もう一度お試しください')
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [inviteToken])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (phase === 'submitting') return // 二重送信を防ぐ
    setError(null)
    setPhase('submitting')

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        idToken,
        inviteToken,
        name,
        nameKana,
        university,
        grade,
        birthday,
        region,
        graduationYear,
        graduationYearOverridden: overridden,
        privacyAgreed,
        groupOptIn,
      }),
    }).catch(() => null)

    const body = (await res?.json().catch(() => null)) as
      | { ok: boolean; message?: string; groupReady?: boolean }
      | null

    if (!res?.ok || !body?.ok) {
      setError(body?.message ?? '送信に失敗しました。もう一度お試しください')
      setPhase('form')
      return
    }

    setGroupReady(body.groupReady ?? true)
    setPhase('done')
  }

  if (phase === 'loading') return <p className="center">読み込み中…</p>

  if (phase === 'bad_token') {
    return (
      <div className="center">
        <h1>リンクをご確認ください</h1>
        <p>このリンクは現在ご利用いただけません。お誘いいただいた方にご確認をお願いします。</p>
      </div>
    )
  }

  if (phase === 'need_friend') {
    return (
      <div className="center">
        <h1>友だち追加をお願いします</h1>
        <p>ご登録の前に、このアカウントを友だち追加してください。追加後、もう一度リンクを開いてください。</p>
      </div>
    )
  }

  if (phase === 'done') {
    return (
      <div className="center">
        <h1>登録が完了しました</h1>
        <p>
          {groupReady
            ? 'トークにグループへのご招待をお送りしました。ご確認ください。'
            : 'お住まいの地域のグループを準備中です。ご案内できるようになりましたらご連絡します。'}
        </p>
        <button type="button" onClick={() => import('@line/liff').then((m) => m.default.closeWindow())}>
          閉じる
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <h1>ご登録</h1>
      <p className="sub">30秒で終わります</p>

      {error && <p className="error">{error}</p>}

      <label className="field">
        <span>お名前</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
               autoComplete="name" required maxLength={50} />
      </label>

      <label className="field">
        <span>ふりがな</span>
        <input type="text" value={nameKana} onChange={(e) => setNameKana(e.target.value)}
               placeholder="たなかたろう" required maxLength={50} />
      </label>

      <label className="field">
        <span>大学</span>
        <input type="text" value={university} onChange={(e) => setUniversity(e.target.value)}
               autoComplete="organization" required maxLength={100} />
      </label>

      <label className="field">
        <span>学年</span>
        <select value={grade} onChange={(e) => { setGrade(e.target.value as Grade); setOverridden(false) }} required>
          <option value="" disabled>選択してください</option>
          {GRADES.map((g) => <option key={g} value={g}>{GRADE_LABELS[g]}</option>)}
        </select>
      </label>

      {grade && (
        <div className="confirm">
          あなたは <strong>{graduationYear ? graduationLabel(graduationYear) : '—'}</strong> ですね？
          <label className="field" style={{ marginTop: '.6rem', marginBottom: 0 }}>
            <span className="hint">違う場合は選び直してください（留年・休学・院進などで前後します）</span>
            <select
              value={graduationYear ?? ''}
              onChange={(e) => { setGraduationYear(Number(e.target.value)); setOverridden(true) }}
              required
            >
              <option value="" disabled>選択してください</option>
              {yearChoices().map((y) => (
                <option key={y} value={y}>{graduationLabel(y)}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="field">
        <span>生年月日</span>
        <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} required />
        <span className="hint">
          年齢確認が必要な案件があるため、正確にご記入ください。案件参加時に学生証をご提示いただく場合があります。
        </span>
      </label>

      <label className="field">
        <span>お住まい（活動したい地域）</span>
        <select value={region} onChange={(e) => setRegion(e.target.value as Region)} required>
          <option value="" disabled>選択してください</option>
          {REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
        </select>
      </label>

      <label className="check">
        <input type="checkbox" checked={groupOptIn} onChange={(e) => setGroupOptIn(e.target.checked)} />
        <span>バイト案件を流すグループに招待してもよろしいですか？</span>
      </label>

      <label className="check">
        <input type="checkbox" checked={privacyAgreed} onChange={(e) => setPrivacyAgreed(e.target.checked)} required />
        <span>
          <a href="/privacy.html" target="_blank" rel="noreferrer">プライバシーポリシー</a>に同意します
        </span>
      </label>

      <button type="submit" disabled={phase === 'submitting'}>
        {phase === 'submitting' ? '送信中…' : '登録する'}
      </button>
    </form>
  )
}

/** 卒業年度の選択肢。今年度から6年先まで */
function yearChoices(): number[] {
  const now = new Date()
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const base = jst.getUTCMonth() + 1 >= 4 ? jst.getUTCFullYear() : jst.getUTCFullYear() - 1
  return Array.from({ length: 6 }, (_, i) => base + 1 + i)
}
