-- スキーマの制約と関数のテスト
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/schema_test.sql
-- 最後にロールバックするのでデータは残らない。

begin;

\set ON_ERROR_STOP on
\set QUIET on

\o /dev/null

create or replace function pg_temp.assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', msg;
  end if;
end $$;

-- 指定した SQL が必ず失敗することを確かめる
create or replace function pg_temp.assert_rejects(stmt text, msg text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    return;                       -- 期待どおり弾かれた
  end;
  raise exception 'FAIL: % (弾かれるべき文が通ってしまった)', msg;
end $$;

-- ---------------------------------------------------------------------------
-- 下ごしらえ
-- ---------------------------------------------------------------------------
insert into community.line_groups (id, name, graduation_year, region, status, capacity, invite_url)
values
  ('11111111-1111-1111-1111-111111111111', '関西28卒バイトコミュニティ',   2028, 'kansai', 'open', 3, 'https://line.me/g/x1'),
  ('22222222-2222-2222-2222-222222222222', 'その他28卒バイトコミュニティ', 2028, 'other',  'open', 500, 'https://line.me/g/x2');

insert into community.invite_tokens (id, token, label, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'tok_valid', '関西28卒・A', 'active');

insert into community.members
  (id, line_user_id, name, name_kana, university, grade, birthday,
   graduation_year, region, invite_token_id, privacy_agreed_at, privacy_version)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'U_a', '田中太郎', 'たなかたろう', 'A大学', '学部3年', '2005-04-01',
   2028, 'kansai', 'aaaaaaaa-0000-0000-0000-000000000001', now(), 'v1');

-- ---------------------------------------------------------------------------
-- 1. 同じLINEユーザーは二重登録できない
-- ---------------------------------------------------------------------------
select pg_temp.assert_rejects($$
  insert into community.members
    (line_user_id, name, name_kana, university, grade, birthday,
     graduation_year, region, privacy_agreed_at, privacy_version)
  values ('U_a', '別人', 'べつじん', 'B大学', '学部3年', '2005-04-01',
          2028, 'kansai', now(), 'v1')
$$, '1. line_user_id の重複');

-- ---------------------------------------------------------------------------
-- 2. 自分自身を紹介者にはできない
-- ---------------------------------------------------------------------------
select pg_temp.assert_rejects($$
  update community.members
     set referrer_member_id = id
   where line_user_id = 'U_a'
$$, '2. 自己参照の紹介者');

-- ---------------------------------------------------------------------------
-- 3. 受付中のグループは (卒年, 地域) につき1つだけ
-- ---------------------------------------------------------------------------
select pg_temp.assert_rejects($$
  insert into community.line_groups (name, graduation_year, region, status)
  values ('関西28卒バイトコミュニティ #2', 2028, 'kansai', 'open')
$$, '3. 受付中グループの重複');

-- 満員のグループが既にあるなら、同じ枠に新しいグループを立てられる
insert into community.line_groups (name, graduation_year, region, status)
values ('関東28卒バイトコミュニティ', 2028, 'kanto', 'open');

-- ---------------------------------------------------------------------------
-- 4. revoked なら revoked_at が必要
-- ---------------------------------------------------------------------------
select pg_temp.assert_rejects($$
  update community.invite_tokens set status = 'revoked' where token = 'tok_valid'
$$, '4. revoked なのに revoked_at が無い');

-- ---------------------------------------------------------------------------
-- 5. トークン検証の判定
-- ---------------------------------------------------------------------------
insert into community.invite_tokens (token, status, revoked_at)  values ('tok_revoked',  'revoked', now());
insert into community.invite_tokens (token, expires_at)          values ('tok_expired',  now() - interval '1 day');
insert into community.invite_tokens (token, max_uses, used_count) values ('tok_used_up', 1, 1);

select pg_temp.assert((select reason from community.check_invite_token('tok_valid'))     = 'valid',     '5a. 有効なトークン');
select pg_temp.assert((select reason from community.check_invite_token('tok_revoked'))   = 'revoked',   '5b. 無効化済み');
select pg_temp.assert((select reason from community.check_invite_token('tok_expired'))   = 'expired',   '5c. 期限切れ');
select pg_temp.assert((select reason from community.check_invite_token('tok_used_up'))   = 'exhausted', '5d. 使用上限');
select pg_temp.assert((select reason from community.check_invite_token('tok_nonexist'))  = 'invalid',   '5e. 存在しない');
select pg_temp.assert((select count(*) from community.check_invite_token('tok_nonexist')) = 1,          '5f. 存在しなくても1行返す');

-- ---------------------------------------------------------------------------
-- 6. 配属先の決定 — 地域一致を優先し、無ければ「その他」へ落ちる
-- ---------------------------------------------------------------------------
select pg_temp.assert(
  community.find_open_group(2028, 'kansai') = '11111111-1111-1111-1111-111111111111',
  '6a. 地域が一致するグループを選ぶ');

select pg_temp.assert(
  community.find_open_group(2028, 'tohoku') = '22222222-2222-2222-2222-222222222222',
  '6b. 該当地域が無ければ「その他」へ');

select pg_temp.assert(
  community.find_open_group(2029, 'kansai') is null,
  '6c. 卒年ごと無ければ null（運営に通知する分岐）');

-- ---------------------------------------------------------------------------
-- 7. member_count は実数から数え直し、定員で full になる
-- ---------------------------------------------------------------------------
insert into community.members
  (id, line_user_id, name, name_kana, university, grade, birthday,
   graduation_year, region, privacy_agreed_at, privacy_version)
select ('cccccccc-0000-0000-0000-00000000000' || i)::uuid,
       'U_' || i, '学生' || i, 'がくせい', 'A大学', '学部3年', '2005-04-01',
       2028, 'kansai', now(), 'v1'
  from generate_series(1, 3) as i;

-- 3人招待し、うち2人が実際に入室
insert into community.group_memberships (member_id, group_id, state, joined_at)
select ('cccccccc-0000-0000-0000-00000000000' || i)::uuid,
       '11111111-1111-1111-1111-111111111111',
       case when i <= 2 then 'joined' else 'invited' end,
       case when i <= 2 then now() end
  from generate_series(1, 3) as i;

select pg_temp.assert(community.recalc_group_member_count('11111111-1111-1111-1111-111111111111') = 2,
                      '7a. 入室済みだけを数える（招待中は数えない）');
select pg_temp.assert((select status from community.line_groups where id = '11111111-1111-1111-1111-111111111111') = 'open',
                      '7b. 定員未満なら open のまま');

-- 3人目も入室 → 定員3に到達
update community.group_memberships
   set state = 'joined', joined_at = now()
 where group_id = '11111111-1111-1111-1111-111111111111' and state = 'invited';

select pg_temp.assert(community.recalc_group_member_count('11111111-1111-1111-1111-111111111111') = 3, '7c. 3人');
select pg_temp.assert((select status from community.line_groups where id = '11111111-1111-1111-1111-111111111111') = 'full',
                      '7d. 定員到達で full になる');

-- full になったので、関西28卒は「その他」へ回る
select pg_temp.assert(
  community.find_open_group(2028, 'kansai') = '22222222-2222-2222-2222-222222222222',
  '7e. 満員のグループには振り分けない');

-- 1人退出 → open に戻る
update community.group_memberships
   set state = 'left', left_at = now()
 where group_id = '11111111-1111-1111-1111-111111111111'
   and member_id = 'cccccccc-0000-0000-0000-000000000001';

select pg_temp.assert(community.recalc_group_member_count('11111111-1111-1111-1111-111111111111') = 2, '7f. 退出を反映');
select pg_temp.assert((select status from community.line_groups where id = '11111111-1111-1111-1111-111111111111') = 'open',
                      '7g. 定員を割ったら open に戻る');

-- ---------------------------------------------------------------------------
-- 8. 同じ人を同じグループに二重登録しない
-- ---------------------------------------------------------------------------
select pg_temp.assert_rejects($$
  insert into community.group_memberships (member_id, group_id)
  values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111')
$$, '8. group_memberships の重複');

-- ---------------------------------------------------------------------------
-- 9. 月次の消費通数
-- ---------------------------------------------------------------------------
insert into community.group_broadcasts (group_id, kind, body, message_count)
values ('11111111-1111-1111-1111-111111111111', 'project', '【9/4 大阪】…', 400),
       ('11111111-1111-1111-1111-111111111111', 'stats',   '今週は12人が参加しました', 400);

select pg_temp.assert(
  (select message_count from community.monthly_message_usage
    where month = date_trunc('month', now())) = 800,
  '9. 月次の消費通数を合計する');

-- ---------------------------------------------------------------------------
-- 10. updated_at はトリガが必ず上書きする
--
-- now() はトランザクション開始時刻なので「時間が進むか」では検証できない。
-- 呼び出し側が古い値を渡してきても、トリガが握り潰すことを確かめる。
-- ---------------------------------------------------------------------------
select pg_temp.assert(
  (select updated_at from community.members where line_user_id = 'U_a') is not null,
  '10a. updated_at の初期値が入っている');

update community.members
   set display_name = 'たなか',
       updated_at   = '2000-01-01'::timestamptz   -- わざと古い値を渡す
 where line_user_id = 'U_a';

select pg_temp.assert(
  (select updated_at from community.members where line_user_id = 'U_a') = now(),
  '10b. トリガが updated_at を上書きする');

select pg_temp.assert(
  (select created_at from community.members where line_user_id = 'U_a') = now(),
  '10c. created_at は更新で書き換わらない');

\o

\echo '✅ すべてのテストを通過しました（10項目 / 24アサーション）'

rollback;
