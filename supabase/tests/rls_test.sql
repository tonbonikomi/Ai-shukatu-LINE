-- アクセス制御のテスト（docs/spec.md §4.10）
--
-- community スキーマが二層で守られていることを確かめる。
--   1層目: 権限そのものが無い（スキーマに触れない）
--   2層目: 仮に権限を与えても RLS が全拒否する（ポリシーが1つも無いため）
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql

begin;

\set ON_ERROR_STOP on
\o /dev/null

create or replace function pg_temp.assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', msg;
  end if;
end $$;

create or replace function pg_temp.assert_rejects(stmt text, msg text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    return;
  end;
  raise exception 'FAIL: % (弾かれるべき文が通ってしまった)', msg;
end $$;

insert into community.members
  (line_user_id, name, name_kana, university, grade, birthday,
   graduation_year, region, privacy_agreed_at, privacy_version)
values ('U_secret', '田中太郎', 'たなかたろう', 'A大学', '学部3年', '2005-04-01',
        2028, 'kansai', now(), 'v1');

-- 一般ロール（bypassrls なし）を用意する。anon / authenticated 相当。
create role test_client nologin;

-- ---------------------------------------------------------------------------
-- 1層目: 権限が無いので、そもそもスキーマに触れない
-- ---------------------------------------------------------------------------
set local role test_client;
select pg_temp.assert_rejects('select * from community.members', '1. 権限なしで members を読めてしまう');
select pg_temp.assert_rejects('select * from community.invite_tokens', '1b. 権限なしで invite_tokens を読めてしまう');
reset role;

-- ---------------------------------------------------------------------------
-- 2層目: 権限を与えても RLS が全拒否する
-- ---------------------------------------------------------------------------
grant usage on schema community to test_client;
grant select, insert, update, delete on community.members to test_client;

set local role test_client;

select pg_temp.assert(
  (select count(*) from community.members) = 0,
  '2a. 権限を与えても RLS で読めないこと（1行も見えてはいけない）');

select pg_temp.assert_rejects($$
  insert into community.members
    (line_user_id, name, name_kana, university, grade, birthday,
     graduation_year, region, privacy_agreed_at, privacy_version)
  values ('U_evil', '偽', 'にせ', 'X大学', '学部1年', '2006-04-01',
          2030, 'kansai', now(), 'v1')
$$, '2b. RLS で書き込みも拒否されること');

reset role;

-- ---------------------------------------------------------------------------
-- 3. サーバ側（RLS を迂回できるロール）からは見える
-- ---------------------------------------------------------------------------
select pg_temp.assert(
  (select count(*) from community.members where line_user_id = 'U_secret') = 1,
  '3. service_role 相当からは読めること');

-- ---------------------------------------------------------------------------
-- 4. 全テーブルで RLS が有効かつ FORCE されている
-- ---------------------------------------------------------------------------
select pg_temp.assert(
  not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'community'
       and c.relkind = 'r'
       and (c.relrowsecurity is false or c.relforcerowsecurity is false)
  ),
  '4. RLS が無効なテーブルが残っている');

-- ---------------------------------------------------------------------------
-- 5. ポリシーは1つも無い（＝全拒否のまま）
-- ---------------------------------------------------------------------------
select pg_temp.assert(
  (select count(*) from pg_policies where schemaname = 'community') = 0,
  '5. 意図しないポリシーが作られている');

\o
\echo '✅ アクセス制御のテストを通過しました（5項目 / 7アサーション）'

rollback;
