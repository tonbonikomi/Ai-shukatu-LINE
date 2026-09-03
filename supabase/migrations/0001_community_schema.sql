-- 紹介制コミュニティ: スキーマとテーブル
-- 対応する仕様: docs/spec.md §3

create schema if not exists community;

-- ---------------------------------------------------------------------------
-- 共通: updated_at の自動更新
-- ---------------------------------------------------------------------------
create or replace function community.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- invite_tokens — 入口リンク（docs/spec.md §3.1）
--
-- 既存の partners.ref_code は恒久・取り消し不可のため使わない。
-- 発行は運営が手動で行う（docs/decisions.md D-001）。
-- ---------------------------------------------------------------------------
create table community.invite_tokens (
  id              uuid primary key default gen_random_uuid(),
  token           text        not null unique,
  owner_member_id uuid,                       -- FK は members 作成後に付与
  label           text,
  status          text        not null default 'active'
                    check (status in ('active', 'revoked', 'expired')),
  max_uses        integer     check (max_uses is null or max_uses > 0),
  used_count      integer     not null default 0 check (used_count >= 0),
  expires_at      timestamptz,
  created_by      text,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz,
  revoked_reason  text,

  -- revoked なら revoked_at が入っていること
  constraint invite_tokens_revoked_consistent
    check ((status = 'revoked') = (revoked_at is not null))
);

create index invite_tokens_owner_idx  on community.invite_tokens (owner_member_id);
create index invite_tokens_status_idx on community.invite_tokens (status);

-- ---------------------------------------------------------------------------
-- members — 登録者（docs/spec.md §3.2）
-- ---------------------------------------------------------------------------
create table community.members (
  id                         uuid primary key default gen_random_uuid(),
  line_user_id               text        not null unique,
  display_name               text,                       -- LINEプロフィール名（参考値）
  name                       text        not null,
  name_kana                  text        not null,
  university                 text        not null,
  grade                      text        not null,       -- 入力値をそのまま保持
  birthday                   date        not null,
  graduation_year            integer     not null,
  graduation_year_overridden boolean     not null default false,
  region                     text        not null
                               check (region in ('kansai','kanto','nagoya','kyushu','tohoku','other')),
  referrer_member_id         uuid        references community.members (id),
  invite_token_id            uuid        references community.invite_tokens (id),
  partner_id                 uuid,                       -- 既存送客DBとの連結（後付け）
  privacy_agreed_at          timestamptz not null,
  privacy_version            text        not null,
  group_opt_in_at            timestamptz,
  status                     text        not null default 'registered'
                               check (status in ('registered','joined_group','left','banned')),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  -- 自分自身を紹介者にはできない
  constraint members_referrer_not_self check (referrer_member_id is distinct from id)
);

create index members_referrer_idx  on community.members (referrer_member_id);
create index members_cohort_idx    on community.members (graduation_year, region);
create index members_token_idx     on community.members (invite_token_id);

create trigger members_touch_updated_at
  before update on community.members
  for each row execute function community.touch_updated_at();

-- 循環参照のため、ここで FK を付与する
alter table community.invite_tokens
  add constraint invite_tokens_owner_fk
  foreign key (owner_member_id) references community.members (id);

-- ---------------------------------------------------------------------------
-- line_groups — グループ台帳（docs/spec.md §3.3）
-- 命名は「{地域}{卒年}バイトコミュニティ」（docs/decisions.md D-003）
-- ---------------------------------------------------------------------------
create table community.line_groups (
  id                    uuid primary key default gen_random_uuid(),
  line_group_id         text unique,          -- botが入室するまで不明
  name                  text        not null,
  graduation_year       integer     not null,
  region                text        not null
                          check (region in ('kansai','kanto','nagoya','kyushu','tohoku','other')),
  invite_url            text,                 -- LINEアプリで手動発行したURL
  invite_url_updated_at timestamptz,
  capacity              integer     not null default 500 check (capacity > 0),
  member_count          integer     not null default 0   check (member_count >= 0),
  status                text        not null default 'preparing'
                          check (status in ('preparing','open','full','rotating_link','closed')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 受付中のグループは (卒年, 地域) につき1つだけ
create unique index line_groups_active_cohort_idx
  on community.line_groups (graduation_year, region)
  where status in ('preparing', 'open');

create trigger line_groups_touch_updated_at
  before update on community.line_groups
  for each row execute function community.touch_updated_at();

-- ---------------------------------------------------------------------------
-- group_memberships — 誰がどのグループに（docs/spec.md §3.4）
-- ---------------------------------------------------------------------------
create table community.group_memberships (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references community.members (id),
  group_id   uuid not null references community.line_groups (id),
  state      text not null default 'invited'
               check (state in ('invited','joined','left','removed')),
  source     text not null default 'auto_invite'
               check (source in ('auto_invite','manual','unknown')),
  invited_at timestamptz not null default now(),
  joined_at  timestamptz,
  left_at    timestamptz,

  unique (member_id, group_id)
);

-- member_count の再計算で毎回引くのでインデックスを張る
create index group_memberships_joined_idx
  on community.group_memberships (group_id)
  where state = 'joined';

-- ---------------------------------------------------------------------------
-- group_join_events — 入退室の生ログと照合結果（docs/spec.md §3.5）
-- ---------------------------------------------------------------------------
create table community.group_join_events (
  id                uuid primary key default gen_random_uuid(),
  line_group_id     text not null,
  line_user_id      text not null,
  event_type        text not null check (event_type in ('joined','left')),
  matched_member_id uuid references community.members (id),
  resolution        text not null default 'pending'
                      check (resolution in ('pending','matched','unknown_notified','manual_ok','removed')),
  raw               jsonb not null,
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_note     text
);

-- 未対応の未登録入室だけを引くための部分インデックス
create index group_join_events_unresolved_idx
  on community.group_join_events (created_at)
  where resolution = 'unknown_notified';

create index group_join_events_user_idx on community.group_join_events (line_user_id);

-- ---------------------------------------------------------------------------
-- group_broadcasts — グループ投稿ログ（docs/spec.md §3.6）
--
-- グループ投稿はメンバー人数分の通数としてカウントされるため、
-- 送信時の人数を残さないと請求が読めない。手動投稿もここに記録する。
-- ---------------------------------------------------------------------------
create table community.group_broadcasts (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references community.line_groups (id),
  project_id    uuid,                       -- 既存 projects への参照
  kind          text not null check (kind in ('project','stats','rule','other')),
  body          text not null,
  message_count integer not null check (message_count >= 0),  -- 送信時のメンバー数 = 消費通数
  sent_at       timestamptz not null default now(),
  sent_by       text
);

create index group_broadcasts_sent_at_idx on community.group_broadcasts (sent_at);
create index group_broadcasts_group_idx   on community.group_broadcasts (group_id, sent_at);

-- ---------------------------------------------------------------------------
-- referrer_scores — 紹介者スコア（docs/spec.md §3.7）
--
-- MVPでは作るだけで集計しない。紹介者の紐付けは初日から全員に記録されるので、
-- 運用データが溜まってから遡って集計できる。
-- ---------------------------------------------------------------------------
create table community.referrer_scores (
  member_id       uuid primary key references community.members (id),
  referred_count  integer not null default 0,
  attended_count  integer not null default 0,
  no_show_count   integer not null default 0,
  rejected_count  integer not null default 0,
  conduct_penalty integer not null default 0,
  score           numeric not null default 0,
  tier            text,                       -- 既存 payout_rates.tier に接続
  updated_at      timestamptz not null default now()
);

create trigger referrer_scores_touch_updated_at
  before update on community.referrer_scores
  for each row execute function community.touch_updated_at();
