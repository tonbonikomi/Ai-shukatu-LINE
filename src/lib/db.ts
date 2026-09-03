import postgres from 'postgres'
import { env } from './env'

/**
 * Postgres への直接接続。
 *
 * community スキーマは PostgREST に公開しない（氏名・大学・生年月日を持つため）。
 * よって supabase-js ではなく、サービスロール相当の接続情報で直接つなぐ。
 * 詳細は supabase/README.md の「接続方法」。
 */
declare global {
  // 開発時のホットリロードで接続が増え続けないように使い回す
  var __communitySql: ReturnType<typeof postgres> | undefined
}

export function db() {
  if (!globalThis.__communitySql) {
    globalThis.__communitySql = postgres(env.databaseUrl, {
      max: 5,
      idle_timeout: 20,
      prepare: false, // Supabase の接続プーラー（transaction mode）と併用するため
    })
  }
  return globalThis.__communitySql
}

/** 一意制約違反かどうか */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
