# データベース

紹介制コミュニティのスキーマ。仕様は [`docs/spec.md` §3](../docs/spec.md#3-データモデル)。

```
supabase/
├── migrations/
│   ├── 0001_community_schema.sql   スキーマとテーブル
│   ├── 0002_functions.sql          補助関数（振り分け・人数再計算・トークン検証）
│   └── 0003_rls.sql                アクセス制御
├── seed.sql                        最初に立てるグループ
└── tests/
    ├── run.sh                      空のDBに適用してテストを流す
    ├── schema_test.sql             制約と関数
    └── rls_test.sql                アクセス制御
```

## テストの実行

```bash
./supabase/tests/run.sh                                  # 使い捨てのローカルDBで実行
DATABASE_URL=postgres://… ./supabase/tests/run.sh        # 既存のDBに対して実行
```

使い捨てDBの場合は `/var/tmp/pgtest-community` にクラスタを作り、`community_test` を
毎回作り直してから全マイグレーションを流す。**順序どおりに空のDBへ通ることも同時に検証している。**

## 接続方法（重要）

**`community` スキーマを Supabase の「Exposed schemas」に追加しないこと。**

このスキーマは氏名・大学・生年月日を保持する。PostgREST に公開すると、
設定を1つ間違えただけで外から到達できてしまう。サーバからは
**Postgres へ直接接続**して読み書きする（接続文字列は環境変数で渡す）。

守りは二層になっている。

| 層 | 内容 |
|---|---|
| 1層目 | `anon` / `authenticated` / `public` から権限そのものを剥奪してある |
| 2層目 | 全テーブルで RLS を有効化し、**ポリシーを1つも作っていない**（＝全拒否） |

`force row level security` を付けてあるので、テーブル所有者にも RLS が適用される。
読み書きできるのは RLS を迂回できるロール（Supabase の `service_role`）だけ。
この2層は `tests/rls_test.sql` で実際に検証している。

## 設計上の注意

### member_count は必ず再計算する
`recalc_group_member_count()` を使い、加算・減算はしない。
webhook を1回でも取りこぼすとカウンタがずれ、それが**定員判定と通数見積りの両方**を壊す。

### グループ投稿は必ず `group_broadcasts` に記録する
グループ投稿はメンバー人数分の通数としてカウントされる（[調査結果 §1](../docs/line-platform-research.md)）。
送信時の人数を残さないと請求が読めない。**自動投稿を作る前の手動投稿も記録すること。**

### 受付中のグループは (卒年, 地域) につき1つ
部分ユニークインデックスで保証している。満員になって `full` にすれば、
同じ枠に次のグループ（`#2`）を立てられる。

### `partners.ref_code` は使わない
恒久・取り消し不可のため「無効化できる入口リンク」という要件を満たさない。
`community.invite_tokens` で別に発行する。
