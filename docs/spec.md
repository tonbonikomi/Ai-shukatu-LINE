# SPEC草案: 紹介制コミュニティ（公式LINE「一柳」）

構想メモ [`referral-community-design.md`](referral-community-design.md) を実装可能な粒度に落としたもの。
調査結果は [`line-platform-research.md`](line-platform-research.md) を参照。

| | |
|---|---|
| ステータス | **草案**（未レビュー・未承認） |
| 作成 | 2026-08-26 |
| 前提 | 構想メモ §8 の5件は**未確定**。本SPECは §0 の仮置きの上に書かれている |

---

## 0. 前提と仮置き

本SPECは以下を仮置きしている。**確定したら本節を更新し、影響範囲を洗い直すこと。**

| # | 仮置き | 根拠 | 崩れた場合の影響 |
|---|---|---|---|
| A1 | 一柳の Messaging API チャネルと登録LIFFの LINEログインチャネルを**同一プロバイダー**に新規作成する | 調査 §3 | **致命的**。userId が照合できず全体が成立しない |
| A2 | 既存の就活DB（送客管理）とは**別プロバイダーでもよい**。連結は `community_members.partner_id` を運用側で紐付ける方式にフォールバックできる | 構想メモ §0 | 中。自動連結ができなくなるだけで、コミュニティ単体は動く |
| A3 | 料金プランは**スタンダード**（30,000通/月、追加は従量） | 調査 §1 | 中。通数の運用ルールを厳しくする必要が出る |
| A4 | 認証済みアカウントは**MVP時点では未取得**。申請は並行して出す | 調査 §2 | 小。棚卸し機能（§4.9）が後回しになるだけ |
| A5 | バックエンドは既存の **Supabase + n8n** を共有する | 構想メモ 冒頭 | 中。別基盤なら §3 のスキーマはそのまま、§4 の実行環境だけ差し替え |
| A6 | 紹介料の支払いは既存の即払い／月末払いの仕組みに乗せる。**法的建付けの確定前は紹介料の支払いを開始しない** | 構想メモ §8-5 | 小。記録は初日から取るので後から遡って支払える |

### 確定した方針（[決定ログ](decisions.md)）

| # | 決定 |
|---|---|
| [D-001](decisions.md#d-001) | 入口リンクは**運営が選んで手渡し**する。一柳による自動発行はしない |
| [D-002](decisions.md#d-002) | 直接招待された人は、登録を依頼し、応じなければ退出させる |
| [D-003](decisions.md#d-003) | グループ名は「{地域}{卒年}バイトコミュニティ」 |
| [D-004](decisions.md#d-004) | 入口リンクは **LIFF直リンク**。⚠ LIFFアプリを作り直すと配布済みリンクが全て死ぬ |

---

## 1. スコープ

### MVPに含む
入口リンクの発行・無効化 / 登録（LIFF） / グループ振り分けと招待リンクの自動返信 / 入室・退室の検知と運営通知 / グループでの沈黙

### MVPに含まない（後付け）
紹介者スコアとティア変動 / グループ自動投稿（案件・実績・残枠） / 定期棚卸し（認証済みが前提） / 紹介料の自動計算・支払い

### 明示的に作らないもの
- 後追い登録フロー（構想メモ §9 で却下済み）
- 承認制OpenChat（同上）
- botによるメンバー強制退出（プラットフォーム上不可能）

---

## 2. 用語とID

| 名前 | 意味 |
|---|---|
| 一柳 | コミュニティ用の LINE公式アカウント（Messaging APIチャネル） |
| 入口リンク | 招待したい学生が配る `https://liff.line.me/{LIFF_ID}?t={token}`（[D-004](decisions.md#d-004)） |
| グループ招待リンク | LINEグループへの参加URL。**一柳のみが保持し、登録完了者にだけ送る** |
| `line_user_id` | プロバイダースコープのユーザーID。LIFFとwebhookで一致する前提（A1） |
| `token` | 入口リンクに埋める招待トークン。発行・無効化可能 |

---

## 3. データモデル

Supabase (PostgreSQL)。既存スキーマとの衝突を避けるため **`community` スキーマ**に切る。

### 3.1 `community.invite_tokens` — 入口リンク

```sql
create table community.invite_tokens (
  id                uuid primary key default gen_random_uuid(),
  token             text not null unique,           -- URLセーフ・推測困難（>=64bit）
  owner_member_id   uuid references community.members(id),  -- 招待したい学生。運営直発行はnull
  label             text,                           -- 用途メモ 例:「関西28卒・田中」
  status            text not null default 'active'
                      check (status in ('active','revoked','expired')),
  max_uses          integer,                        -- null = 無制限
  used_count        integer not null default 0,
  expires_at        timestamptz,
  created_by        text,
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  revoked_reason    text
);
create index on community.invite_tokens (owner_member_id);
create index on community.invite_tokens (status);
```

> **既存の `partners.ref_code` は使わない。** 恒久・取り消し不可のため「無効化できる入口リンク」という要件を満たさない（構想メモ §6）。
> 既存パートナーとの対応が必要になったら `invite_tokens.owner_member_id → members.partner_id` の経路で辿る。

### 3.2 `community.members` — 登録者

```sql
create table community.members (
  id                  uuid primary key default gen_random_uuid(),
  line_user_id        text not null unique,
  display_name        text,                          -- LINEプロフィール名（参考値）
  name                text not null,                 -- 氏名
  name_kana           text not null,                 -- ふりがな
  university          text not null,
  grade               text not null,                 -- 学年（入力値をそのまま保持）
  birthday            date not null,
  graduation_year     integer not null,              -- 学年から自動計算（§4.3）
  graduation_year_overridden boolean not null default false,
  region              text not null
                        check (region in ('kansai','kanto','nagoya','kyushu','tohoku','other')),
  referrer_member_id  uuid references community.members(id),
  invite_token_id     uuid references community.invite_tokens(id),
  partner_id          uuid,                          -- 既存送客DBとの連結（後付け・A2）
  privacy_agreed_at   timestamptz not null,
  privacy_version     text not null,                 -- 同意時のポリシー版数
  group_opt_in_at     timestamptz,                   -- 構想メモ §3-4 の同意
  status              text not null default 'registered'
                        check (status in ('registered','joined_group','left','banned')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on community.members (referrer_member_id);
create index on community.members (graduation_year, region);
```

> `privacy_version` を持つのは、ポリシーを改訂したときに「誰がどの版に同意したか」を後から示せるようにするため。
> 構想メモ §8-4 の追記が入る前提なので、最初から入れておく。

### 3.3 `community.line_groups` — グループ台帳

```sql
create table community.line_groups (
  id               uuid primary key default gen_random_uuid(),
  line_group_id    text unique,                      -- botが入室するまで不明なのでnull許容
  name             text not null,                    -- 例:「関西28卒バイトコミュニティ」
  graduation_year  integer not null,
  region           text not null,
  invite_url       text,                             -- LINEアプリで手動発行したURL
  invite_url_updated_at timestamptz,
  capacity         integer not null default 500,
  member_count     integer not null default 0,
  status           text not null default 'preparing'
                     check (status in ('preparing','open','full','rotating_link','closed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index on community.line_groups (graduation_year, region)
  where status in ('preparing','open');
```

### 3.4 `community.group_memberships` — 誰がどのグループに

```sql
create table community.group_memberships (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references community.members(id),
  group_id    uuid not null references community.line_groups(id),
  state       text not null default 'invited'
                check (state in ('invited','joined','left','removed')),
  source      text not null default 'auto_invite'
                check (source in ('auto_invite','manual','unknown')),
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,
  left_at     timestamptz,
  unique (member_id, group_id)
);
```

### 3.5 `community.group_join_events` — 入退室の生ログと照合結果

```sql
create table community.group_join_events (
  id             uuid primary key default gen_random_uuid(),
  line_group_id  text not null,
  line_user_id   text not null,
  event_type     text not null check (event_type in ('joined','left')),
  matched_member_id uuid references community.members(id),
  resolution     text not null default 'pending'
                   check (resolution in ('matched','unknown_notified','manual_ok','removed','pending')),
  raw            jsonb not null,
  created_at     timestamptz not null default now(),
  resolved_at    timestamptz,
  resolved_note  text
);
create index on community.group_join_events (resolution) where resolution = 'unknown_notified';
```

### 3.6 `community.group_broadcasts` — グループ投稿ログ（通数管理）

```sql
create table community.group_broadcasts (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references community.line_groups(id),
  project_id     uuid,                        -- 既存 projects への参照（案件告知の場合）
  kind           text not null check (kind in ('project','stats','rule','other')),
  body           text not null,
  message_count  integer not null,            -- 送信時点のメンバー数 = 消費通数
  sent_at        timestamptz not null default now(),
  sent_by        text
);
```

> **調査 §1 の通り、グループ投稿はメンバー人数分カウントされる。**
> 消費通数を残しておかないと月末の請求が読めない。MVPで自動投稿を作らなくても、
> **このテーブルだけは先に作って手動投稿も記録する**こと。

### 3.7 `community.referrer_scores` — 紹介者スコア（後付けフェーズ）

```sql
create table community.referrer_scores (
  member_id       uuid primary key references community.members(id),
  referred_count  integer not null default 0,
  attended_count  integer not null default 0,
  no_show_count   integer not null default 0,   -- ドタキャン
  rejected_count  integer not null default 0,   -- 否認
  conduct_penalty integer not null default 0,   -- 素行（グループ内勧誘等）
  score           numeric not null default 0,
  tier            text,                          -- 既存 payout_rates.tier に接続
  updated_at      timestamptz not null default now()
);
```

> MVPでは**テーブルだけ作って集計は動かさない**。
> 紹介者の紐付け（`members.referrer_member_id`）は初日から全員に記録されるので、
> 運用データが溜まってから遡って集計できる（構想メモ §10）。

---

## 4. 機能仕様

### 4.1 チャネル構成

| チャネル | 種別 | 役割 |
|---|---|---|
| 一柳 | Messaging API | 友だち追加・1対1・グループへの投稿・webhook受信 |
| 一柳ログイン | LINEログイン | 登録LIFFのホスト |

**両方を同一プロバイダーに作成する（A1）。作成前に既存就活DBのプロバイダーを確認すること。**

**着手前チェック（必須）**: テストユーザー1名で、LIFFの `liff.getProfile().userId` と、
そのユーザーが一柳に発言したときの webhook の `source.userId` が**文字列として一致する**ことを確認する。
ここが一致しなければ以降の実装は全て無意味になる。

### 4.2 入口リンクと登録の導線

**採用する形: LIFF先行**

```
入口リンク  https://liff.line.me/{LIFF_ID}?t={token}
   │
   ├─ LIFF起動（LINEログインチャネル）
   │    liff.init() → 未ログインなら liff.login()
   │    ※ LIFFアプリ側で「ボットリンク機能」を aggressive に設定し、
   │      ログイン時に一柳の友だち追加を同時に促す
   │
   ├─ liff.getFriendship() で一柳の友だち状態を確認
   │    friendFlag === false → 「まず一柳を友だち追加してください」と表示して登録させない
   │
   ├─ token を API で検証（§4.4）
   │    無効/取り消し済み/上限到達 → エラー表示＋運営に通知
   │
   ├─ 登録フォーム（5項目＋同意）
   │
   └─ 送信 → サーバで ID トークン検証（§4.10）→ members に保存
        └─ 一柳から **プッシュメッセージ** でグループ招待リンクを送信（1通消費）
```

**なぜ「友だち追加リンク先行」ではなく LIFF 先行なのか**
友だち追加URL（`https://line.me/R/ti/p/@xxx`）からの `follow` webhook には、
誰の紹介で来たかを示すパラメータを載せられない。それをやると紹介者の紐付けが取れなくなり、
構想の中核（全員に紹介者が紐付く）が崩れる。よって token を確実に運べる LIFF を先に通す。

**LIFF先行の弱点と対処**
友だち追加していない人でも LIFF は開けてしまうため、`liff.getFriendship()` による
友だちチェックを**必須のゲート**にする。ここが構想メモ §3-2 の「実質の関所」の実装箇所。

### 4.3 登録フォーム

| 項目 | 型 | バリデーション |
|---|---|---|
| 氏名 | text | 必須・1〜50字 |
| ふりがな | text | 必須・ひらがなのみ |
| 大学 | text | 必須。サジェスト付き自由入力（表記ゆれは後で名寄せ） |
| 学年 | select | 必須。学部1〜4年 / 修士1〜2年 / 博士 / その他 |
| 生年月日 | date | 必須。1990-01-01 〜 (今日 - 15年) の範囲 |
| 地域 | select | 必須。関西 / 関東 / 名古屋 / 九州 / 東北 / その他 |
| プライバシーポリシー同意 | checkbox | 必須 |

> 構想メモ §3-3 は5項目だが、グループ振り分け（学年 × **地域**）に地域が必須なので**地域を追加**している。
> 大学名からの推定は下宿・オンラインで外すため、本人に選ばせる。

**卒業年度の自動計算**

「28卒」は2028年3月に卒業する人を指す。年度は4月始まりなので、
**2027年度の学部4年生が2028年3月に卒業して「28卒」**になる。つまり:

```
卒年 = 年度 + 卒業までの残り年数        （最終学年の残り年数は 1）

学部1年 → 年度 + 4      修士1年 → 年度 + 2
学部2年 → 年度 + 3      修士2年 → 年度 + 1
学部3年 → 年度 + 2      博士   → 年度 + 1（年数が読めないので最終学年として扱う）
学部4年 → 年度 + 1      その他 → 推定しない（本人に選ばせる）

年度 = 4〜12月ならその年 / 1〜3月なら前年
```

> ⚠ **年度の判定は必ず JST に直してから行う。** サーバは UTC で動くため、
> UTC のまま判定すると 3/31 と 4/1 の境界で1年ずれ、その日に登録した人が
> まるごと違うグループに振り分けられる。
> 実装は `src/lib/domain/graduation.ts`、境界のテストは `tests/graduation.test.ts`。

算出結果を確認画面に「あなたは **28卒** ですね？」と表示し、違えば手動で直せるようにする
（`graduation_year_overridden = true` を立てる）。留年・休学・院進で必ずズレる人がいるため。

**年齢の文言（構想メモ §4）** — 生年月日欄の直下に、この1文だけを置く。
> 年齢確認が必要な案件があるため、正確にご記入ください。案件参加時に学生証をご提示いただく場合があります。

### 4.4 招待トークン

**発行ポリシー（[D-001](decisions.md#d-001)）: 運営が選んで手渡しする。自動発行はしない。**
登録完了や案件参加をトリガーにした自動発行は実装しない。
将来切り替える場合も、発行トリガーを足すだけでスキーマとフローは変わらない。

**発行**
- 運営が管理画面から発行。`label` に用途を書く（誰に渡したか分かるように）
- token は 暗号論的乱数 16バイト → base64url（22文字）。連番・推測可能な値は使わない
- `owner_member_id` を設定すると、そのトークン経由の登録者に紹介者が自動で紐づく

**検証（LIFFから呼ばれるAPI）**

| 条件 | 結果 |
|---|---|
| 存在しない | `invalid` → 「リンクが正しくありません」 |
| `status = 'revoked'` | `revoked` → 「このリンクは現在ご利用いただけません」＋運営に通知 |
| `expires_at < now()` | `expired` → 同上 |
| `max_uses` 到達 | `exhausted` → 同上 |
| それ以外 | `valid` → 紹介者情報を返す |

**無効化**: `status='revoked'`, `revoked_at`, `revoked_reason` を記録。既に登録済みの人には影響しない。

**used_count の増加タイミング**: token検証時ではなく**登録完了時**。LIFFを開いただけで消費させない。

### 4.5 グループ振り分け

登録完了時に `(graduation_year, region)` から配属先を決める。

```
1. status='open' かつ member_count < capacity のグループを (graduation_year, region) で検索
   → ヒット: そのグループの invite_url を返す
2. ヒットなし → (graduation_year, 'other') で再検索
   → ヒット: そのグループへ
3. それでもなし → 運営に通知し、本人には「準備中」メッセージ
   members.status は 'registered' のまま。グループ開設後に運営が手動で招待リンクを送る
```

**送信メッセージ（プッシュ・1通消費）**
```
{name}さん、登録ありがとうございます！
バイト案件が流れるグループにご招待します。下のリンクから参加してください。

{invite_url}

※このリンクはあなた専用です。転送しないでください。
※案件の詳細・応募はこのトーク（1対1）で受け付けます。
```

同時に `group_memberships` に `state='invited'` で先行記録する。
実際の入室は `memberJoined` で `state='joined'` に確定させる（§4.7）。

**定員到達時**: `member_count >= capacity` になったら `status='full'` に自動遷移し、運営に通知。
運営が新グループを作成 → 台帳に登録 → 以降の登録者は新グループへ。

### 4.6 グループでは黙る

構想メモ §9 の通り、グループ内の全発言が webhook に届く。**誤爆すると場が死ぬ**ので二重に塞ぐ。

1. **LINE Official Account Manager 側**: 応答モードを「Bot」、自動応答メッセージ OFF、
   あいさつメッセージは1対1のみ有効
2. **webhookハンドラ側**: 最初のガードとして下記を置く

```
if (event.source.type === 'group' || event.source.type === 'room') {
  if (event.type === 'message') {
    // 記録のみ。返信しない。
    return;
  }
  // memberJoined / memberLeft / join / leave のみ処理する
}
```

**例外**: `memberJoined` への歓迎メッセージだけは返す（replyToken 使用・**無料**）。
内容はルール掲示を兼ねる。

```
ようこそ！
・案件の詳細と応募は一柳とのトーク（1対1）で受け付けます
・グループ内での勧誘・営業は禁止です
```

### 4.7 入室・退室の検知

**`memberJoined`**
```
for each joined.members[].userId:
  group_join_events に raw を記録
  community.members を line_user_id で照合
    ├─ 見つかった
    │    group_memberships を state='joined', joined_at=now() に更新
    │      （invited レコードが無い＝直接招待された → source='manual' で新規作成）
    │    line_groups.member_count を実数で再計算
    │    members.status を 'joined_group' に
    │    resolution='matched'
    └─ 見つからない（未登録者）
         resolution='unknown_notified'
         運営に通知（§4.8）
         一柳から登録を依頼（プッシュ1通）→ 猶予期間内に登録されなければ
         運営の業務用アカウントから退出（D-002）
         ※ botは退出させられない。退出の操作は必ず人手（構想メモ §9）
```

**`memberLeft`**: `group_memberships.state='left'`, `left_at` を記録。`member_count` を再計算。

**`member_count` の扱い**: インクリメント／デクリメントではなく、
`group_memberships` の `state='joined'` の件数から**毎回再計算**する。
webhookの取りこぼしがあるとカウンタがずれ、それが定員判定と通数見積りの両方を壊すため。

### 4.8 運営への通知

未登録者の入室、トークンの不正使用、グループの定員到達、振り分け先なし、を運営に飛ばす。

- 送り先: 運営用の通知チャネル（n8n → Slack / または運営の個人LINE）
- **一柳から運営個人にプッシュで送ると通数を消費する**ので、Slack など LINE 外を推奨
- 内容: 何が起きたか / 対象のグループ名 / userId / 表示名 / 取るべき対応

### 4.9 定期棚卸し（認証済みアカウント取得後・後付け）

`getGroupMemberIds` で全メンバーを取得し、`group_memberships` と突き合わせる。

- DBにあってLINEにない → 退出を取りこぼしている → `state='left'` に補正
- LINEにあってDBにない → webhook停止中に入った人 → 運営に通知
- 実行頻度: 週1回程度

**これは通数コストに直結する**（調査 §1）。実在しないメンバーを数えたまま投稿しても課金はされないが、
「反応しない休眠メンバー」を放置すると毎投稿その人数分が課金される。棚卸しの結果は
グループ整理（休眠者の退出依頼／グループ統合）の判断材料にする。

### 4.10 セキュリティ

| 項目 | 対策 |
|---|---|
| LIFFからの登録 | クライアントが送る userId を**信用しない**。`liff.getIDToken()` を送らせ、サーバ側で `https://api.line.me/oauth2/v2.1/verify` に検証してから userId を確定する |
| webhook | `X-Line-Signature` をチャネルシークレットで検証。不一致は破棄 |
| 招待トークン | 暗号論的乱数16バイト。ログに平文で残さない |
| グループ招待リンク | **DBとサーバ内に閉じる**。管理画面でも伏字表示にし、閲覧は権限者のみ |
| Supabase | `community` スキーマのテーブルは RLS を有効にし、匿名キーからのアクセスを全面禁止。書き込みはサービスロールを持つサーバ経由のみ |
| 個人情報 | 生年月日・大学・氏名を保持する。アクセスログを残し、閲覧権限を絞る |

---

## 5. 通数の運用ルール（調査 §1 を受けて新規）

**着手前に数値を決めること。** SPECレビュー時の宿題。

| 項目 | 案 | 決定 |
|---|---|---|
| グループあたりの投稿頻度上限 | 週2回 | 未定 |
| 月間通数のアラート閾値 | 無料枠の80%（24,000通） | 未定 |
| グループ投稿に載せる情報 | 案件の存在・締切・エリアのみ。**金額は書かない**（構想メモ §3-6） | 確定 |
| 個別配信を使う基準 | 対象者が全体の1/3以下に絞れる案件は個別 | 未定 |
| 1対1の詳細案内 | ユーザーに先に発言させて **reply で返す**（無料化・調査 §1） | 推奨 |

`group_broadcasts.message_count` の月次集計をダッシュボードに出し、請求を予測可能にする。

---

## 6. 監視すべき指標

| 指標 | 出し方 | 何を見るか |
|---|---|---|
| 入口リンク別の登録転換率 | `invite_tokens` × `members` | どの紹介者が機能しているか |
| 登録 → 入室の転換率 | `group_memberships` の invited / joined | 招待リンクが機能しているか |
| 未登録入室の件数 | `group_join_events` の `unknown_notified` | 直接招待がどれだけ起きているか。多いなら例外処理では足りない |
| グループ別アクティブ率 | 投稿への反応 / メンバー数 | 通数コストに対する効き。休眠の見極め |
| 月間消費通数 | `group_broadcasts` の合計 | 請求の予測 |

---

## 7. プライバシーポリシー追記（構想メモ §8-4 の草案）

法務レビュー前提の**たたき台**。既存 `/privacy.html` に追記する項目:

| 取得情報 | 利用目的 |
|---|---|
| 氏名・ふりがな | 本人確認、案件参加時の照合、報酬支払時の口座名義との照合 |
| 大学名・学年 | 参加条件のある案件のマッチング、コミュニティグループの振り分け |
| 生年月日 | 年齢制限のある案件の可否判定 |
| 地域 | 勤務地に基づく案件のマッチング、コミュニティグループの振り分け |
| LINEのユーザー識別子 | 本サービスにおけるユーザーの識別、連絡 |
| 紹介者の情報 | 紹介制度の運用、紹介料の算定 |

**あわせて書くべきこと**
- 第三者提供の有無（案件先の企業に氏名等を提供する場合はその旨）
- 保存期間と削除請求の方法
- 既存の送客サービスとデータを共有する場合はその旨（A2 の判断次第）

> ⚠ 本節は技術者による草案であり、法的な妥当性は保証しない。**弁護士確認が必須**。
> 構想メモ §8-5（紹介料の建付け）の確認と同じタイミングで進めること。

---

## 8. SPEC確定までの宿題

| # | 宿題 | 担当 |
|---|---|---|
| 0 | D-002 の猶予期間（推奨3日）とリマインド回数（推奨1回）を決める | kaz |
| 1 | 既存就活DBのプロバイダー確認 → 一柳の2チャネルを同一プロバイダーに作成 | kaz |
| 2 | userId 一致のテスト（§4.1 の着手前チェック） | 実装 |
| 3 | 認証済みアカウントの申請を出すか決める（推奨: 出す） | kaz |
| 4 | §5 の通数運用ルールの数値を決める | kaz |
| 5 | プライバシーポリシー追記 → 弁護士確認 | 法務 |
| 6 | 紹介料の建付け → 弁護士確認 | 法務 |
| 7 | 最初に立てるグループの構成を決める（構想メモ §5 の ● から） | kaz |
