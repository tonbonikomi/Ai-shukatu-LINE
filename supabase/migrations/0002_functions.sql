-- 紹介制コミュニティ: 補助関数
-- 対応する仕様: docs/spec.md §4.5, §4.7

-- ---------------------------------------------------------------------------
-- member_count の再計算（docs/spec.md §4.7）
--
-- インクリメント／デクリメントはしない。webhookを1回でも取りこぼすとカウンタが
-- ずれ、それが定員判定と通数見積りの両方を壊すため、毎回実数から数え直す。
-- 定員に達したら status を full に、割ったら open に自動で戻す。
-- ---------------------------------------------------------------------------
create or replace function community.recalc_group_member_count(p_group_id uuid)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  select count(*)
    into v_count
    from community.group_memberships
   where group_id = p_group_id
     and state = 'joined';

  update community.line_groups
     set member_count = v_count,
         status = case
                    when status = 'open' and v_count >= capacity then 'full'
                    when status = 'full' and v_count <  capacity then 'open'
                    else status
                  end
   where id = p_group_id;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 配属先グループの決定（docs/spec.md §4.5）
--
--   1. (卒年, 地域) で受付中のグループ
--   2. なければ (卒年, その他)
--   3. それもなければ null → 呼び出し側が運営に通知する
-- ---------------------------------------------------------------------------
create or replace function community.find_open_group(
  p_graduation_year integer,
  p_region          text
)
returns uuid
language sql
stable
as $$
  select id
    from (
      select id,
             case when region = p_region then 0 else 1 end as priority
        from community.line_groups
       where graduation_year = p_graduation_year
         and status = 'open'
         and member_count < capacity
         and (region = p_region or region = 'other')
    ) candidates
   order by priority, id     -- 地域一致を優先。同点は id で決めて結果を安定させる
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 招待トークンの検証（docs/spec.md §4.4）
--
-- 返す reason: valid / invalid / revoked / expired / exhausted
-- used_count はここでは増やさない。増やすのは登録完了時。
-- ---------------------------------------------------------------------------
create or replace function community.check_invite_token(p_token text)
returns table (reason text, token_id uuid, owner_member_id uuid)
language sql
stable
as $$
  select
    case
      when t.id is null                                     then 'invalid'
      when t.status = 'revoked'                             then 'revoked'
      when t.status = 'expired'                             then 'expired'
      when t.expires_at is not null and t.expires_at < now() then 'expired'
      when t.max_uses is not null and t.used_count >= t.max_uses then 'exhausted'
      else 'valid'
    end,
    t.id,
    t.owner_member_id
  from (select null::uuid) as anchor
  left join community.invite_tokens t on t.token = p_token;
$$;

-- ---------------------------------------------------------------------------
-- 月次の消費通数（docs/spec.md §5 / 運用の通数監視）
--
-- グループ投稿はメンバー人数分カウントされるため、請求の予測はここから出す。
-- ---------------------------------------------------------------------------
create or replace view community.monthly_message_usage as
  select date_trunc('month', sent_at) as month,
         count(*)                     as broadcast_count,
         sum(message_count)           as message_count
    from community.group_broadcasts
   group by 1
   order by 1 desc;

-- ---------------------------------------------------------------------------
-- 入口リンクのトークンを発行する（docs/spec.md §4.4 / docs/decisions.md D-001）
--
-- 発行は運営が手動で行う方針なので、SQL 1行で発行できるようにしてある。
--   select community.new_invite_token('関西28卒・田中');
--
-- gen_random_uuid() は PostgreSQL 13 以降、暗号論的に安全な乱数を使う。
-- ハイフンを除いた32桁の16進文字列（128bit）をトークンにする。
-- 拡張機能を必要としないので、どの Supabase プロジェクトでもそのまま動く。
-- ---------------------------------------------------------------------------
create or replace function community.new_invite_token(
  p_label           text        default null,
  p_owner_member_id uuid        default null,
  p_max_uses        integer     default null,
  p_expires_at      timestamptz default null,
  p_created_by      text        default 'manual'
)
returns text
language plpgsql
as $$
declare
  v_token text;
begin
  v_token := replace(gen_random_uuid()::text, '-', '');

  insert into community.invite_tokens
    (token, label, owner_member_id, max_uses, expires_at, created_by)
  values
    (v_token, p_label, p_owner_member_id, p_max_uses, p_expires_at, p_created_by);

  return v_token;
end;
$$;

-- ---------------------------------------------------------------------------
-- 発行済みの入口リンク一覧。
-- LIFF ID はDBに持たないので、リンクの組み立ては呼び出し側で行う。
--
--   select label, 'https://liff.line.me/<LIFF_ID>?t=' || token as link
--     from community.active_invite_tokens;
-- ---------------------------------------------------------------------------
create or replace view community.active_invite_tokens as
  select t.token,
         t.label,
         m.name as owner_name,
         t.used_count,
         t.max_uses,
         t.expires_at,
         t.created_at
    from community.invite_tokens t
    left join community.members m on m.id = t.owner_member_id
   where t.status = 'active'
     and (t.expires_at is null or t.expires_at > now())
     and (t.max_uses is null or t.used_count < t.max_uses)
   order by t.created_at desc;
