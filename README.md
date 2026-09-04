# Ai-shukatu-LINE

株式会社AI就活の、公式LINE「一柳」を使った紹介制の就活生コミュニティに関するリポジトリ。

現時点では設計ドキュメントのみで、実装は未着手。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [紹介制コミュニティ構想](docs/referral-community-design.md) | 背景・方針・登録フロー・グループ分割・運用設計（2026-08-26 時点の構想メモ） |
| [LINEプラットフォーム調査結果](docs/line-platform-research.md) | 通数カウント・`getGroupMemberIds` の条件・userIDのプロバイダースコープの裏取りと、そこから導かれる設計方針 |
| [SPEC草案](docs/spec.md) | データモデル・機能仕様・セキュリティ・通数の運用ルール |
| [MVP実装計画](docs/mvp-implementation-plan.md) | フェーズ分割・依存関係・受け入れ条件・リスク |
| [運用設計](docs/operations.md) | 誰が何をするか。日次・週次・月次の作業、案件投稿の型、例外時の手順、立ち上げ期の進め方 |
| **[セットアップ手順](docs/setup-guide.md)** | **上から順にやれば動く手順書。まずこれ** |
| [着手前チェックリスト](docs/preflight-checklist.md) | 実装側で用意できないもの。申請・法務・アカウント・認証情報・決めごと |
| [決定ログ](docs/decisions.md) | 決まった方針と、その理由・引き受けたトレードオフ・覆すときのコスト |
| [用語集](docs/glossary.md) | LIFF・プロバイダー・通数など、資料に出てくる言葉の説明 |

## 開発

```bash
npm install
cp .env.example .env.local     # 値を埋める
npm run dev                    # http://localhost:3000/register

npm run check                  # 型チェック + ユニットテスト + DBテスト
```

| コマンド | 内容 |
|---|---|
| `npm run typecheck` | TypeScript の型チェック |
| `npm run test` | ユニットテスト（vitest） |
| `npm run test:db` | 空のDBにマイグレーションを流してSQLのテスト |
| `npm run build` | 本番ビルド |

### 構成

```
src/
├── app/
│   ├── register/                  登録画面（LIFF）
│   └── api/
│       ├── invite/[token]/        入口リンクの検証
│       ├── register/              登録の受付
│       └── line/webhook/          LINE からの通知の受け口
├── lib/
│   ├── domain/                    卒業年度の計算・入力検証・トークン生成
│   ├── line/                      署名検証・イベント振り分け・送信
│   ├── liff/                      IDトークンの検証
│   └── db.ts                      Postgres への直接接続
└── server/                        登録処理・入室検知・運営通知・文面
supabase/                          マイグレーションとSQLのテスト
```

判断が入るところ（卒業年度の計算・署名検証・イベントの振り分け・入力検証）は
`src/lib` の純粋な関数に切り出してあり、テストで固定してある。

## 現在の状態

構想フェーズ。着手前に確定すべき事項が **4件** 残っている（構想メモ §8。うち通数プランは調査済み）。

**最優先は LINEのプロバイダ選定。** 後から変更できず、既存の就活DBと同じプロバイダでないと
LIFF の userId と `memberJoined` の userId が照合できないため、構想の土台が崩れる。
実装計画のフェーズ0-4（userId 一致テスト）が通るまでコードを書き始めないこと。

## 調査で判明した重要事項

**グループへの投稿は、メンバー人数分の通数としてカウントされる**（1通ではない）。
500人グループへの1投稿 = 500通。構想メモ §8-3 の「1通ならグループ投稿を告知の主役にできる」という
前提は成立しないため、投稿頻度の上限を運用ルールとして先に決める必要がある。
一方で応答メッセージ（reply）は無料なので、1対1の詳細案内は組み方次第でコストをかけずに回せる。

詳細は [調査結果](docs/line-platform-research.md) を参照。
