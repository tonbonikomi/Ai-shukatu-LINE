/**
 * 環境変数。
 * 参照された時点で検証する（ビルド時に未設定でも落ちないようにするため）。
 */
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`)
  return value
}

export const env = {
  get databaseUrl() {
    return required('DATABASE_URL')
  },
  get lineChannelSecret() {
    return required('LINE_CHANNEL_SECRET')
  },
  get lineChannelAccessToken() {
    return required('LINE_CHANNEL_ACCESS_TOKEN')
  },
  /** IDトークンの検証に使う。LIFF をぶら下げている LINEログインチャネルのID */
  get lineLoginChannelId() {
    return required('LINE_LOGIN_CHANNEL_ID')
  },
  get privacyPolicyVersion() {
    return process.env.PRIVACY_POLICY_VERSION ?? 'unversioned'
  },
  get opsSlackWebhookUrl(): string | null {
    return process.env.OPS_SLACK_WEBHOOK_URL ?? null
  },
}
