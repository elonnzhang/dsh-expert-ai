#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
HARNESS="${REAL_WEB_HARNESS:-$REPO/../deepseek-harness-0.2.0-rc.2}"
PORT="${REAL_WEB_PORT:-3098}"
export DSH_HOME="${REAL_WEB_HOME:-$REPO/.dsh-test-identity}"

die() { echo "real-web: $*" >&2; exit 1; }

usage() {
  echo "usage: scripts/real-web.sh start|stop|status|url" >&2
  echo "  env: REAL_WEB_HARNESS REAL_WEB_HOME REAL_WEB_PORT REAL_WEB_PATCHES (space-separated overlay files)" >&2
  exit 2
}

[[ -f "$HARNESS/apps/cli/src/bin.ts" ]] || die "no Harness checkout at $HARNESS (set REAL_WEB_HARNESS)"
HARNESS="$(cd "$HARNESS" && pwd -P)"
[[ "$DSH_HOME/" != "$HOME/.dsh/"* ]] || die "refusing to use $HOME/.dsh; pick another REAL_WEB_HOME"
mkdir -p "$DSH_HOME"
DSH_HOME="$(cd "$DSH_HOME" && pwd -P)"
USER_HOME="$(cd "$HOME" && pwd -P)"
[[ "$DSH_HOME/" != "$USER_HOME/.dsh/"* ]] || die "refusing to use $USER_HOME/.dsh; pick another REAL_WEB_HOME"
export DSH_HOME

STATE="$DSH_HOME/real-web"
PIDFILE="$STATE/web.pid"
PORTFILE="$STATE/web.port"
LOGFILE="$STATE/web.log"
if [[ "${1:-}" != start && -f "$PORTFILE" ]]; then PORT="$(<"$PORTFILE")"; fi
[[ "$PORT" =~ ^[0-9]+$ ]] || die "the port must be a number, got: $PORT"
PLUGIN="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).name)' "$REPO/package.json")"

group_members() { ps -axww -o pid=,pgid=,command= | awk -v g="$1" '$2 == g'; }

leader_is_ours() {
  [[ -f "$PIDFILE" ]] || return 1
  local pid
  pid="$(<"$PIDFILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  local pgid cmd port="$PORT"
  if [[ -f "$PORTFILE" ]]; then port="$(<"$PORTFILE")"; fi
  read -r pgid cmd < <(ps -ww -o pgid= -o command= -p "$pid" 2>/dev/null) || return 1
  [[ "$pgid" == "$pid" && "$cmd" == *" dsh web "* && "$cmd" == *"--port $port"* ]]
}

port_free() { ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; }

link_plugin() {
  [[ -f "$DSH_HOME/profiles/web/node_modules/$PLUGIN/package.json" ]] && return 0
  (cd "$HARNESS" && pnpm -s dsh plugin --profile web add "$REPO")
}

ready_url() { awk '/^dsh web: http/ { sub(/^dsh web: /, ""); print $1; exit }' "$LOGFILE" 2>/dev/null; }

report_activation() {
  { grep -E 'did not activate|^[A-Za-z0-9._#/-]+ \([^)]*\): ' "$LOGFILE" 2>/dev/null || true; } \
    | grep -v 'token=' | cut -c1-300 | sed 's/^/real-web: /' >&2 || true
}

cmd_start() {
  if [[ -f "$PIDFILE" ]]; then
    if leader_is_ours; then die "already running (pid $(<"$PIDFILE"))"; fi
    if kill -0 "$(<"$PIDFILE")" 2>/dev/null; then die "$PIDFILE names a live process I do not recognise; remove it if it is stale"; fi
  fi
  [[ -f "$REPO/lib/index.js" && -f "$REPO/lib/client.js" ]] || die "lib/ is missing; run pnpm run build first"
  port_free || die "port $PORT is already in use"
  local overlays=() file
  for file in ${REAL_WEB_PATCHES:-}; do
    [[ -f "$file" ]] || die "overlay not found: $file"
    overlays+=(--patch "$file")
  done
  link_plugin
  umask 077
  mkdir -p "$STATE"
  : >"$LOGFILE"
  echo "$PORT" >"$PORTFILE"
  cd "$HARNESS"
  nohup perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die "exec: $!\n"' -- \
    pnpm -s dsh web ${overlays[@]+"${overlays[@]}"} --host 127.0.0.1 --port "$PORT" --no-open \
    </dev/null >>"$LOGFILE" 2>&1 &
  echo "$!" >"$PIDFILE"
  sleep 1
  leader_is_ours || { cmd_stop >/dev/null 2>&1 || true; die "the server did not become its own process group leader; see $LOGFILE"; }
  local waited=0 limit="${REAL_WEB_TIMEOUT:-300}"
  while [[ -z "$(ready_url)" ]]; do
    leader_is_ours || die "the server exited before it was ready; see $LOGFILE"
    ((waited < limit)) || { cmd_stop >/dev/null 2>&1 || true; die "no ready line after ${limit}s; see $LOGFILE"; }
    sleep 2
    waited=$((waited + 2))
  done
  echo "ready in ${waited}s: http://127.0.0.1:$PORT/ (pid $(<"$PIDFILE"), log $LOGFILE)"
  report_activation
}

cmd_stop() {
  [[ -f "$PIDFILE" ]] || { echo "not running"; return 0; }
  local pid
  pid="$(<"$PIDFILE")"
  [[ "$pid" =~ ^[0-9]+$ ]] || die "malformed pid file $PIDFILE"
  if ! leader_is_ours; then
    if kill -0 "$pid" 2>/dev/null; then
      die "pid $pid is alive but does not look like this script's server; not touching it (remove $PIDFILE if it is stale)"
    fi
    if [[ "$(group_members "$pid")" != *"apps/cli/src/bin.ts"* ]]; then
      rm -f "$PIDFILE"
      echo "not running (removed a stale pid file)"
      return 0
    fi
    echo "leader $pid is gone but its group still runs the Harness; stopping the group"
  fi
  kill -TERM -- "-$pid" 2>/dev/null || true
  local tries=0
  while [[ -n "$(group_members "$pid")" ]]; do
    ((tries < 50)) || { kill -KILL -- "-$pid" 2>/dev/null || true; break; }
    sleep 0.2
    tries=$((tries + 1))
  done
  rm -f "$PIDFILE"
  echo "stopped"
}

cmd_status() {
  if leader_is_ours; then
    echo "running pid $(<"$PIDFILE") http://127.0.0.1:$PORT/ log $LOGFILE"
    return 0
  fi
  echo "stopped"
  return 3
}

cmd_url() {
  leader_is_ours || die "not running"
  local url
  url="$(ready_url)"
  [[ -n "$url" ]] || die "no ready line in $LOGFILE yet"
  echo "$url"
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  url) cmd_url ;;
  *) usage ;;
esac
