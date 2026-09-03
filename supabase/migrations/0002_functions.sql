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
