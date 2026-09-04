# セットアップ手順

**上から順にやれば動きます。** 迷ったらこの順番どおりに。
所要時間の目安は STEP1〜7 で合計2〜3時間（審査の待ち時間を除く）。

---

## 今日出しておくもの（待ち時間があるので先に）

| # | やること | 待ち時間 |
|---|---|---|
| 1 | **認証済みアカウントを申請**（LINE公式アカウント管理画面 → 設定 → アカウント認証） | 5〜10営業日。申請中も運用は止まらない |
| 2 | **弁護士に2件投げる** ①プライバシーポリシーの追記 ②紹介料の建付け | 数週間 |
| 3 | **業務用の電話番号・端末を手配**（グループ管理用LINE 2つ分） | 数日 |

> 3が要る理由: メンバーの強制退出・招待リンクの発行・リアクションは**botにはできず**、
> 人間の個人アカウントにしかできません。担当者の私物LINEでグループを作ると、
> その人が辞めた時点で**運営権が復旧不可能**になります。

---

## STEP 1 — LINEのチャネルを作る（30分）

> ⚠️ **ここが唯一やり直せない工程です。** プロバイダーを間違えると全部作り直しになります。

1. [LINE Developers コンソール](https://developers.line.biz/console/) にログイン
2. **既存の送客管理LIFF `2010483281-…` がどのプロバイダーにあるか確認し、名前をメモする**
3. **そのプロバイダーを開いて**「新規チャネル作成」→ **Messaging API** → 名前は「一柳」
4. **同じプロバイダーで**もう1つ「新規チャネル作成」→ **LINEログイン** → 名前は「一柳ログイン」
5. LINEログインチャネル → **LIFF** タブ → 「追加」
   - サイズ: **Full**
   - エンドポイントURL: `https://example.com/register`（STEP4で本物に差し替える）
   - スコープ: **profile** と **openid** にチェック
   - ボットリンク機能: **On (Aggressive)** → 一柳を選択
6. 発行された **LIFF ID** をメモ

**なぜ同じプロバイダーでないといけないか**
LINEのユーザーIDは**プロバイダーごとに発行**されます。別プロバイダーだと、
登録画面で取得したIDとグループ入室時のIDが別物になり、
**登録した田中さんとグループに入ってきた田中さんが同一人物だと分からなくなります。**

---

## STEP 2 — 4つの値を集める（10分）

| 環境変数 | どこにあるか |
|---|---|
| `LINE_CHANNEL_SECRET` | 一柳（Messaging API）→ チャネル基本設定 → チャネルシークレット |
| `LINE_CHANNEL_ACCESS_TOKEN` | 一柳 → Messaging API設定 → チャネルアクセストークン（長期）を「発行」 |
| `LINE_LOGIN_CHANNEL_ID` | 一柳ログイン → チャネル基本設定 → **チャネルID**（数字） |
| `NEXT_PUBLIC_LIFF_ID` | STEP1-6 でメモした LIFF ID |

⚠️ この4つはチャットやIssueに貼らないこと。

---

## STEP 3 — データベースを用意する（20分）

1. Supabase の **SQL Editor** を開く
2. 下の3ファイルの中身を、**この順番で**貼って実行する
   - `supabase/migrations/0001_community_schema.sql`
   - `supabase/migrations/0002_functions.sql`
   - `supabase/migrations/0003_rls.sql`
3. 続けて `supabase/seed.sql` を実行（最初の2グループが登録される）
4. **Settings → Database → Connection string → URI** をコピー → `DATABASE_URL`

> ⚠️ **Settings → API → Exposed schemas に `community` を追加しないでください。**
> 氏名・大学・生年月日を持つスキーマです。公開すると設定1つの間違いで外から届きます。

**確認**: SQL Editor で以下を実行し、2行返ってくればOK。
```sql
select name, graduation_year, region, status from community.line_groups;
```

---

## STEP 4 — デプロイする（30分）

1. [Vercel](https://vercel.com/new) でこのGitHubリポジトリをインポート
2. Framework は Next.js（自動検出されます）。ブランチは `claude/referral-community-design-vh42oj`
3. **Environment Variables** に貼る

   ```
   DATABASE_URL           = STEP3-4 でコピーしたもの
   LINE_CHANNEL_SECRET    = STEP2
   LINE_CHANNEL_ACCESS_TOKEN = STEP2
   LINE_LOGIN_CHANNEL_ID  = STEP2
   NEXT_PUBLIC_LIFF_ID    = STEP2
   OPS_SLACK_WEBHOOK_URL  = Slackの Incoming Webhook URL
   PRIVACY_POLICY_VERSION = 2026-08-26
   REGISTRATION_GRACE_DAYS = 3
   ```

4. デプロイ → 払い出されたURL（`https://xxx.vercel.app`）をメモ
5. **LIFFのエンドポイントURL**を `https://xxx.vercel.app/register` に変更（STEP1-5の仮URLを差し替え）
6. 一柳 → Messaging API設定 → **Webhook URL** に `https://xxx.vercel.app/api/line/webhook`
   → **「検証」を押して成功すること**
7. 同じ画面で設定する
   - Webhookの利用: **オン**
   - 応答メッセージ: **オフ** ← グループでの誤爆を防ぐ1枚目のガード
   - あいさつメッセージ: 任意

---

## STEP 5 — userId一致テスト（15分・**ここが通るまで先に進まない**）

STEP1でプロバイダーを間違えていないかを、実データで確かめます。

1. Supabase の SQL Editor でテスト用トークンを1つ発行
   ```sql
   select community.new_invite_token('セットアップ確認用');
   ```
   返ってきた32桁の文字列をコピー

2. `https://liff.line.me/{LIFF_ID}?t={いまの文字列}` を自分のLINEに送ってタップ
3. 一柳を友だち追加 → 登録フォームを最後まで送信
4. **グループ招待のメッセージが一柳から届けば、登録は成功しています**
5. Supabase で登録されたIDを確認
   ```sql
   select line_user_id, name, graduation_year, region from community.members;
   ```
6. 一柳のトークに何か一言送る → Vercel の **Logs** に `[line] 1対1メッセージ U...` が出る

**5と6の `U...` が完全に一致すればOK。**

一致しなければ、STEP1でプロバイダーを間違えています。**チャネルを作り直してください。**
（後から変更はできません）

---

## STEP 6 — 最初のグループを立てる（30分）

1. **業務用アカウント**で「関西28卒バイトコミュニティ」を作成
2. **運営メンバーをもう1人以上入れる**（1つのアカウントが使えなくなっても運営権が残るように）
3. **一柳を招待** → Slackに「グループに一柳が入りました」が届く
4. グループ設定 → **招待リンクを発行してコピー**
5. Supabase で受付を開始する
   ```sql
   update community.line_groups
      set invite_url = 'コピーしたリンク',
          invite_url_updated_at = now(),
          status = 'open'
    where name = '関西28卒バイトコミュニティ';
   ```
6. ノート／固定表示にルールを掲示する
   ```
   ・案件の詳細と応募は一柳とのトーク（1対1）で受け付けます
   ・グループ内での勧誘・営業は禁止です
   ```

関東28卒も立てるなら 1〜5 を繰り返す。

---

## STEP 7 — 最初の10人に配る（15分）

1. トークンをまとめて発行（配る相手の名前を `label` に書く）
   ```sql
   select community.new_invite_token('関西28卒・田中');
   select community.new_invite_token('関西28卒・佐藤');
   ```

2. 発行済みの一覧とリンクを確認
   ```sql
   select label,
          'https://liff.line.me/ここにLIFF_IDを入れる?t=' || token as link,
          used_count
     from community.active_invite_tokens;
   ```

3. `link` をそのまま本人に送る

> 誰かが荒らしたら、そのリンクだけ止められます。
> ```sql
> update community.invite_tokens
>    set status = 'revoked', revoked_at = now(), revoked_reason = '理由'
>  where label = '関西28卒・田中';
> ```
> 既に登録済みの人には影響しません。

---

## 動き出したあと

| いつ | やること |
|---|---|
| 毎日 | Slackの通知を見る（15〜30分）／案件を流す／1対1の応募対応 |
| 投稿したら | **運営全員でリアクションを付ける**（最初の10投稿は必須。botにはできない） |
| 毎週 | 入口リンクの配り先を見直す ← ここが拡大速度そのもの |
| 毎月 | 消費通数と請求の確認 |

詳しくは [運用設計](operations.md) と [運用ハンドブック](https://claude.ai/code/artifact/0dcd0b26-5c9f-4e7d-84a6-b557f66a708c)。

---

## つまずいたら

| 症状 | 原因 |
|---|---|
| Webhookの「検証」が失敗する | URL末尾が `/api/line/webhook` か / 環境変数の反映後に再デプロイしたか |
| 登録画面が「友だち追加をお願いします」で止まる | 一柳を友だち追加していない。追加してからリンクを開き直す |
| 「リンクをご確認ください」と出る | トークンが無効・期限切れ・使い切り。`check_invite_token` で理由を確認 |
| 登録は通るがグループ招待が来ない | グループが `open` になっていない（STEP6-5）／`invite_url` が空 |
| 入室してもSlackに通知が来ない | `line_groups.line_group_id` が埋まっていない。一柳を招待し直す |
| STEP5でIDが一致しない | **プロバイダー違い。チャネルを作り直す**（他に手はありません） |
