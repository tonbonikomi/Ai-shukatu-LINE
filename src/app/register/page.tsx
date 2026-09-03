import { Suspense } from 'react'
import RegisterForm from './RegisterForm'

export const dynamic = 'force-dynamic'

export default function RegisterPage() {
  return (
    <main>
      <Suspense fallback={<p className="center">読み込み中…</p>}>
        <RegisterForm />
      </Suspense>
    </main>
  )
}
