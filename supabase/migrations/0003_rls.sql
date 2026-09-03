-- 紹介制コミュニティ: アクセス制御
-- 対応する仕様: docs/spec.md §4.10
--
-- 方針: community スキーマは外部から一切触れない。
--   - RLS を有効にし、ポリシーを1つも作らない（＝全拒否）
--   - anon / authenticated からは権限そのものを剥奪する
--   - 読み書きは service_role を持つサーバ経由のみ（service_role は RLS を迂回する）
--
-- 氏名・大学・生年月日を保持するため、クライアントから直接触れる経路を作らないこと。
-- Supabase の「Exposed schemas」に community を追加してはいけない。

-- RLS を有効化（ポリシーが無い ＝ 全拒否）
alter table community.invite_tokens     enable row level security;
alter table community.members           enable row level security;
alter table community.line_groups       enable row level security;
alter table community.group_memberships enable row level security;
alter table community.group_join_events enable row level security;
alter table community.group_broadcasts  enable row level security;
alter table community.referrer_scores   enable row level security;

-- テーブル所有者にも RLS を適用する（所有者は既定で迂回してしまうため）
alter table community.invite_tokens     force row level security;
alter table community.members           force row level security;
alter table community.line_groups       force row level security;
alter table community.group_memberships force row level security;
alter table community.group_join_events force row level security;
alter table community.group_broadcasts  force row level security;
alter table community.referrer_scores   force row level security;

-- 権限そのものを剥奪する（RLS の手前でもう1枚塞ぐ）
revoke all on schema community from public;
revoke all on all tables    in schema community from public;
revoke all on all functions in schema community from public;
revoke all on all sequences in schema community from public;

-- 以後に作られるオブジェクトにも同じ既定を適用する
alter default privileges in schema community revoke all on tables    from public;
alter default privileges in schema community revoke all on functions from public;
alter default privileges in schema community revoke all on sequences from public;

-- Supabase のロールが存在する環境でだけ、明示的に剥奪する
-- （ローカルの素の PostgreSQL では anon / authenticated が存在しないためスキップ）
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema community from %I', r);
      execute format('revoke all on all tables    in schema community from %I', r);
      execute format('revoke all on all functions in schema community from %I', r);
      execute format('revoke all on all sequences in schema community from %I', r);
      execute format('alter default privileges in schema community revoke all on tables    from %I', r);
      execute format('alter default privileges in schema community revoke all on functions from %I', r);
      execute format('alter default privileges in schema community revoke all on sequences from %I', r);
      raise notice 'revoked community schema privileges from %', r;
    end if;
  end loop;
end;
$$;
