-- 最初に立てるグループ（docs/mvp-implementation-plan.md 0-9 / 1-5）
--
-- 命名規則は「{地域}{卒年}バイトコミュニティ」（docs/decisions.md D-003）。
-- line_group_id と invite_url は、実際にグループを作って一柳を招待してから埋める。
-- それまでは status = 'preparing' なので振り分け対象にならない。

insert into community.line_groups (name, graduation_year, region, status)
values
  ('関西28卒バイトコミュニティ', 2028, 'kansai', 'preparing'),
  ('関東28卒バイトコミュニティ', 2028, 'kanto',  'preparing')
on conflict do nothing;
