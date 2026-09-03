#!/usr/bin/env bash
# マイグレーションを空のDBに適用し、テストを流す。
#
#   ./supabase/tests/run.sh                        # 使い捨てのローカルDBを立てて実行
#   DATABASE_URL=postgres://… ./supabase/tests/run.sh   # 既存のDBに対して実行
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL=(psql "$DATABASE_URL")
else
  PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
  PGD=${PGD:-/var/tmp/pgtest-community}
  PORT=${PORT:-55433}

  if [[ ! -d "$PGD" ]]; then
    mkdir -p "$PGD"
    # PostgreSQL は root では起動できないので postgres ユーザーで動かす
    if [[ "$(id -u)" == "0" ]]; then
      chown postgres:postgres "$PGD"
      su postgres -s /bin/bash -c "$PGBIN/initdb -D $PGD -U postgres -A trust" >/dev/null
    else
      "$PGBIN/initdb" -D "$PGD" -U postgres -A trust >/dev/null
    fi
  fi

  START="$PGBIN/pg_ctl -D $PGD -o '-p $PORT -k /tmp -c listen_addresses=' -l $PGD/log"
  if [[ "$(id -u)" == "0" ]]; then
    su postgres -s /bin/bash -c "$START status" >/dev/null 2>&1 || su postgres -s /bin/bash -c "$START start" >/dev/null
  else
    eval "$START status" >/dev/null 2>&1 || eval "$START start" >/dev/null
  fi
  sleep 1

  psql -h /tmp -p "$PORT" -U postgres -q -c "drop database if exists community_test" -c "create database community_test"
  PSQL=(psql -h /tmp -p "$PORT" -U postgres -d community_test)
fi

for f in supabase/migrations/*.sql; do
  echo "→ $f"
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -q -f "$f"
done

for t in supabase/tests/*_test.sql; do
  echo "→ $t"
  "${PSQL[@]}" -v ON_ERROR_STOP=1 -q -f "$t"
done
