#!/usr/bin/env bash
# Deploy this app on its own port without changing other projects or services.
set -Eeuo pipefail

HOST=187.77.86.146
PORT=3080
SSH_PORT=22
IDENTITY=""
SKIP_BUILD=0
CHECK_ONLY=0
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'HELP'
Usage: ./deploy.sh [options]

  --host HOST       Server IP or hostname (default: 187.77.86.146)
  --port PORT       Dedicated app port (default: 3080)
  --identity FILE   SSH private key; otherwise use your SSH configuration
  --ssh-port PORT   SSH port (default: 22)
  --skip-build      Use the existing apps/web/dist build
  --check           Read-only remote preflight; no build, upload, or changes
  --help            Show this help

Requires root SSH access with an already trusted host key. This script only
manages /opt/prompt-studio, /var/lib/prompt-studio, the prompt-studio user,
and prompt-studio.service. It never changes other services or firewall rules.
The backend key comes from apps/api/.env and is transferred separately.
HELP
}

fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --host|--port|--identity|--ssh-port)
      (($# >= 2)) || fail "Missing value for $1."
      case "$1" in
        --host) HOST=$2 ;;
        --port) PORT=$2 ;;
        --identity) IDENTITY=$2 ;;
        --ssh-port) SSH_PORT=$2 ;;
      esac
      shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --check) CHECK_ONLY=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1. Use --help." ;;
  esac
done
[[ "$HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || fail "Use an IPv4 address or hostname."
[[ "$PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$PORT >= 1024 && 10#$PORT <= 65535)) || fail "App port must be between 1024 and 65535."
[[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] && ((10#$SSH_PORT >= 1 && 10#$SSH_PORT <= 65535)) || fail "SSH port must be between 1 and 65535."
PORT=$((10#$PORT))
SSH_PORT=$((10#$SSH_PORT))
command -v ssh >/dev/null || fail "Install the SSH client first."
SSH_OPTIONS=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ConnectionAttempts=3 -o ServerAliveInterval=15 -p "$SSH_PORT")
SCP_OPTIONS=(-o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ConnectionAttempts=3 -P "$SSH_PORT")
if [[ -n "$IDENTITY" ]]; then
  [[ -f "$IDENTITY" && -r "$IDENTITY" ]] || fail "The SSH identity is not a readable file."
  SSH_OPTIONS+=(-i "$IDENTITY" -o IdentitiesOnly=yes)
  SCP_OPTIONS+=(-i "$IDENTITY" -o IdentitiesOnly=yes)
fi

# Every remote argument is a validated number or a generated safe identifier.
# The same preflight runs before setup and again before activating a release.
REMOTE_SCRIPT=$(cat <<'REMOTE'
set -Eeuo pipefail
MODE=$1
PORT=$2
RELEASE=${3:-}
BASE=/opt/prompt-studio
APP_USER=prompt-studio
APP_HOME=/var/lib/prompt-studio
UNIT=prompt-studio.service
UNIT_PATH=/etc/systemd/system/prompt-studio.service
MARKER=prompt-studio-deploy-v1
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }
[[ "$MODE" =~ ^(check|prepare|deploy|cleanup)$ ]] || fail "Invalid operation."
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1024 && PORT <= 65535)) || fail "Invalid port."
[[ "$MODE" == check || "$RELEASE" =~ ^[0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9]+$ ]] || fail "Invalid release identifier."

is_marker() {
  [[ -f "$1" && ! -L "$1" && $(stat -c %u "$1") == 0 && $(stat -c %a "$1") == 600 ]] && [[ "$(cat "$1")" == "$MARKER" ]]
}
root_directory() {
  [[ -d "$1" && ! -L "$1" && $(stat -c %u "$1") == 0 ]] || fail "Unrelated or unsafe directory: $1."
  local bits
  bits=$(stat -c %a "$1")
  (( (8#$bits & 0022) == 0 )) || fail "Directory is writable by other users: $1."
}
owned_file() {
  [[ -f "$1" && ! -L "$1" && $(stat -c %u "$1") == 0 ]] || fail "Unrelated or unsafe file: $1."
  local bits
  bits=$(stat -c %a "$1")
  (( (8#$bits & 0022) == 0 )) || fail "File is writable by other users: $1."
}

preflight() {
  [[ $(id -u) == 0 ]] || fail "Root SSH access is required."
  for command in systemctl runuser useradd getent install stat mktemp python3 curl ss tar mv ln readlink; do
    command -v "$command" >/dev/null || fail "Required server command is missing: $command. No packages were installed."
  done
  [[ -x /usr/bin/node && -x /usr/bin/npm ]] || fail "This deployment requires /usr/bin/node and /usr/bin/npm."
  /usr/bin/node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit((a===22&&b>=18)||(a===24&&b>=11)||a>=26?0:1)' || fail "Node must satisfy ^22.18.0, ^24.11.0, or >=26.0.0. System Node was not changed."
  [[ -d /run/systemd/system ]] || fail "The server must use systemd."

  if [[ -e "$BASE" || -L "$BASE" ]]; then
    root_directory "$BASE"
    is_marker "$BASE/.managed" || fail "$BASE belongs to another deployment."
    root_directory "$BASE/releases"
    root_directory "$BASE/shared"
    if [[ -e "$BASE/current" || -L "$BASE/current" ]]; then
      [[ -L "$BASE/current" ]] || fail "The current release must be this app's symlink."
      local target
      target=$(readlink "$BASE/current")
      [[ "$target" =~ ^/opt/prompt-studio/releases/[0-9]{8}T[0-9]{6}Z-[0-9]+-[0-9]+$ ]] || fail "Unexpected current release target."
      root_directory "$target"
      is_marker "$target/.managed" || fail "The current release is not managed by this script."
    fi
    if [[ -e "$BASE/shared/api.env" || -L "$BASE/shared/api.env" ]]; then
      owned_file "$BASE/shared/api.env"
      [[ $(stat -c %a "$BASE/shared/api.env") == 600 ]] || fail "The backend environment must have mode 600."
    fi
  fi

  local user_record
  if user_record=$(getent passwd "$APP_USER"); then
    [[ -d "$BASE" ]] && is_marker "$BASE/.managed" || fail "The prompt-studio user already belongs to another project."
    local name password uid gid description home shell
    IFS=: read -r name password uid gid description home shell <<< "$user_record"
    [[ "$home" == "$APP_HOME" && "$shell" == /usr/sbin/nologin && "$uid" -gt 0 ]] || fail "Unexpected prompt-studio user configuration."
    [[ -d "$APP_HOME" && ! -L "$APP_HOME" && $(stat -c %u "$APP_HOME") == "$uid" ]] || fail "Unexpected app home ownership."
    is_marker "$APP_HOME/.managed" || fail "The app home belongs to another project."
  else
    [[ ! -e "$APP_HOME" && ! -L "$APP_HOME" ]] || fail "$APP_HOME already belongs to another project."
    ! getent group "$APP_USER" >/dev/null || fail "The prompt-studio group already belongs to another project."
  fi

  local fragment load_state
  fragment=$(systemctl show "$UNIT" -p FragmentPath --value 2>/dev/null || true)
  load_state=$(systemctl show "$UNIT" -p LoadState --value 2>/dev/null || true)
  if [[ -e "$UNIT_PATH" || -L "$UNIT_PATH" || "$load_state" != not-found && -n "$load_state" ]]; then
    [[ -d "$BASE" ]] && is_marker "$BASE/.managed" || fail "The service name is already in use."
    owned_file "$UNIT_PATH"
    [[ "$(head -n 1 "$UNIT_PATH")" == "# $MARKER" ]] || fail "The existing service is unrelated."
    [[ -z "$fragment" || "$fragment" == "$UNIT_PATH" ]] || fail "A different service uses this name."
    [[ ! -d /etc/systemd/system/$UNIT.d && ! -d /run/systemd/system/$UNIT.d ]] || fail "Unexpected service overrides; inspect them before deployment."
  fi

  local listeners main_pid remaining listener_pid found_pid=0
  listeners=$(ss -H -ltnp "sport = :$PORT")
  if [[ -n "$listeners" ]]; then
    [[ -f "$UNIT_PATH" ]] || fail "Port $PORT is occupied. No process was stopped."
    main_pid=$(systemctl show "$UNIT" -p MainPID --value)
    [[ "$main_pid" =~ ^[1-9][0-9]*$ ]] || fail "Port $PORT is occupied by another process."
    remaining=$listeners
    while [[ "$remaining" =~ pid=([0-9]+) ]]; do
      listener_pid=${BASH_REMATCH[1]}
      [[ "$listener_pid" == "$main_pid" ]] || fail "Port $PORT is occupied by another process."
      found_pid=1
      remaining=${remaining#*"pid=$listener_pid"}
    done
    ((found_pid)) || fail "Unable to verify the process listening on port $PORT."
  fi
}

INCOMING=$BASE/.incoming-$RELEASE
if [[ "$MODE" == cleanup ]]; then
  [[ $(id -u) == 0 ]] || fail "Root SSH access is required."
  root_directory "$BASE"
  is_marker "$BASE/.managed" || fail "This app directory is not managed by this script."
  if [[ -e "$INCOMING" || -L "$INCOMING" ]]; then
    root_directory "$INCOMING"
    is_marker "$INCOMING/.managed" || fail "This upload is not managed by this script."
    rm -rf -- "$INCOMING"
  fi
  exit 0
fi

preflight
if [[ "$MODE" == check ]]; then
  printf 'Preflight passed: Node %s; isolated app port %s is available or owned by this app.\n' "$(/usr/bin/node --version)" "$PORT"
  exit 0
fi

if [[ "$MODE" == prepare ]]; then
  [[ ! -e "$INCOMING" && ! -L "$INCOMING" ]] || fail "This upload directory already exists."
  if [[ ! -d "$BASE" ]]; then
    install -d -o root -g root -m 755 "$BASE" "$BASE/releases" "$BASE/shared"
    printf '%s\n' "$MARKER" > "$BASE/.managed"
    chmod 600 "$BASE/.managed"
  fi
  if ! getent passwd "$APP_USER" >/dev/null; then
    useradd --system --user-group --home-dir "$APP_HOME" --create-home --shell /usr/sbin/nologin "$APP_USER"
    chmod 750 "$APP_HOME"
    printf '%s\n' "$MARKER" > "$APP_HOME/.managed"
    chmod 600 "$APP_HOME/.managed"
  fi
  install -d -o root -g root -m 700 "$INCOMING"
  printf '%s\n' "$MARKER" > "$INCOMING/.managed"
  chmod 600 "$INCOMING/.managed"
  exit 0
fi

root_directory "$INCOMING"
is_marker "$INCOMING/.managed" || fail "The upload directory is not managed by this script."
owned_file "$INCOMING/release.tar.gz"
owned_file "$INCOMING/api.env"
chmod 600 "$INCOMING/api.env"
RELEASE_DIR=$BASE/releases/$RELEASE
[[ ! -e "$RELEASE_DIR" && ! -L "$RELEASE_DIR" ]] || fail "This release already exists."
previous_current=$(readlink "$BASE/current" 2>/dev/null || true)
had_env=0
had_unit=0
was_active=0
was_enabled=0
activated=0
if [[ -f "$BASE/shared/api.env" ]]; then cp -p "$BASE/shared/api.env" "$INCOMING/previous.env"; had_env=1; fi
if [[ -f "$UNIT_PATH" ]]; then cp -p "$UNIT_PATH" "$INCOMING/previous.service"; had_unit=1; fi
if systemctl is-active --quiet "$UNIT"; then was_active=1; fi
if systemctl is-enabled --quiet "$UNIT" 2>/dev/null; then was_enabled=1; fi

finish() {
  local status=$?
  trap - EXIT
  if ((status != 0 && activated)); then
    printf 'Deployment failed; restoring this app\047s previous configuration.\n' >&2
    systemctl stop "$UNIT" >/dev/null 2>&1 || true
    if ((!was_enabled)); then systemctl disable "$UNIT" >/dev/null 2>&1 || true; fi
    if [[ -n "$previous_current" ]]; then
      ln -s "$previous_current" "$BASE/.rollback-$RELEASE"
      mv -Tf "$BASE/.rollback-$RELEASE" "$BASE/current"
    else
      rm -f -- "$BASE/current"
    fi
    if ((had_env)); then install -o root -g root -m 600 "$INCOMING/previous.env" "$BASE/shared/api.env"; else rm -f -- "$BASE/shared/api.env"; fi
    if ((had_unit)); then install -o root -g root -m 644 "$INCOMING/previous.service" "$UNIT_PATH"; else rm -f -- "$UNIT_PATH"; fi
    systemctl daemon-reload
    if ((was_active && had_unit)); then systemctl start "$UNIT" || printf 'Previous service could not restart; inspect journalctl -u %s.\n' "$UNIT" >&2; fi
  fi
  # Only this invocation's marked upload is removed; releases are retained.
  if [[ -d "$INCOMING" && ! -L "$INCOMING" ]] && is_marker "$INCOMING/.managed"; then rm -rf -- "$INCOMING"; fi
  exit "$status"
}
trap finish EXIT

# Refuse archive links, traversal, secrets, and files outside the app payload.
python3 - "$INCOMING/release.tar.gz" <<'PY'
import pathlib, sys, tarfile
allowed = ("apps/api/src/", "apps/web/dist/", "packages/shared/src/")
manifests = {"package.json", "package-lock.json", "tsconfig.base.json", "apps/api/package.json", "apps/web/package.json", "packages/shared/package.json"}
with tarfile.open(sys.argv[1], "r:gz") as archive:
    for entry in archive.getmembers():
        path = pathlib.PurePosixPath(entry.name)
        if path.is_absolute() or ".." in path.parts or entry.issym() or entry.islnk() or not (entry.isfile() or entry.isdir()):
            raise SystemExit("Unsafe archive entry.")
        if any(part in {".git", "node_modules"} or part.startswith(".env") for part in path.parts):
            raise SystemExit("Private or unnecessary archive entry.")
        if entry.isfile() and entry.name not in manifests and not entry.name.startswith(allowed):
            raise SystemExit("Unexpected archive file.")
PY
install -d -o root -g root -m 755 "$RELEASE_DIR"
tar --no-same-owner --no-same-permissions -xzf "$INCOMING/release.tar.gz" -C "$RELEASE_DIR"
printf '%s\n' "$MARKER" > "$RELEASE_DIR/.managed"
chmod 600 "$RELEASE_DIR/.managed"
chown -R "$APP_USER:$APP_USER" "$RELEASE_DIR"
printf 'Installing production dependencies for this release…\n'
# Match this project's pinned npm without upgrading the server's global npm.
# Bootstrap outside the release, so an older npm never has to read its lockfile.
npm_spec=$(/usr/bin/node -p "require('$RELEASE_DIR/package.json').packageManager")
[[ "$npm_spec" =~ ^npm@([0-9]+\.[0-9]+\.[0-9]+)$ ]] || fail "The project must pin an npm version."
npm_version=${BASH_REMATCH[1]}
npm_prefix=$APP_HOME/.deploy-tools/npm-$npm_version
npm_cli=$npm_prefix/node_modules/npm/bin/npm-cli.js
if [[ ! -f "$npm_cli" ]]; then
  (cd "$APP_HOME" && runuser -u "$APP_USER" -- env -i HOME="$APP_HOME" PATH=/usr/bin:/bin /usr/bin/npm install --prefix "$npm_prefix" --package-lock=false --ignore-scripts --no-audit --no-fund "$npm_spec")
fi
installed_npm=$(runuser -u "$APP_USER" -- env -i HOME="$APP_HOME" PATH=/usr/bin:/bin /usr/bin/node "$npm_cli" --version)
[[ "$installed_npm" == "$npm_version" ]] || fail "The app-private npm version did not match the project."
(cd "$RELEASE_DIR" && runuser -u "$APP_USER" -- env -i HOME="$APP_HOME" PATH=/usr/bin:/bin NODE_ENV=production /usr/bin/node "$npm_cli" ci --omit=dev --no-audit --no-fund)
chown -R root:root "$RELEASE_DIR"
chmod -R go-w "$RELEASE_DIR"
chmod 600 "$RELEASE_DIR/.managed"

cat > "$INCOMING/service" <<SERVICE
# $MARKER
[Unit]
Description=Prompt Studio
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$BASE/current
Environment=NODE_ENV=production
Environment=API_PORT=$PORT
EnvironmentFile=$BASE/shared/api.env
ExecStart=/usr/bin/node --import tsx $BASE/current/apps/api/src/start.ts
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_HOME
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictRealtime=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
AmbientCapabilities=
MemoryMax=512M
CPUQuota=50%
TasksMax=128

[Install]
WantedBy=multi-user.target
SERVICE

# Recheck the chosen port immediately before replacing this app's configuration.
preflight
activated=1
install -o root -g root -m 600 "$INCOMING/api.env" "$BASE/shared/api.env.new"
mv -f "$BASE/shared/api.env.new" "$BASE/shared/api.env"
ln -s "$RELEASE_DIR" "$BASE/.current-$RELEASE"
mv -Tf "$BASE/.current-$RELEASE" "$BASE/current"
install -o root -g root -m 644 "$INCOMING/service" "$UNIT_PATH"
systemctl daemon-reload
systemctl enable "$UNIT"
systemctl restart "$UNIT"

healthy=0
for attempt in {1..20}; do
  if systemctl is-active --quiet "$UNIT" &&
     curl --fail --silent --max-time 3 "http://127.0.0.1:$PORT/api/config" | python3 -c 'import json,sys; data=json.load(sys.stdin); sys.exit(0 if data.get("configured") is True and data.get("provider")=="groq" else 1)' 2>/dev/null &&
     curl --fail --silent --max-time 3 "http://127.0.0.1:$PORT/" | python3 -c 'import sys; sys.exit(0 if "<!doctype html" in sys.stdin.read().lower() else 1)'; then
    healthy=1
    break
  fi
  sleep 1
done
((healthy)) || fail "This app did not pass its local health checks."
systemctl --no-pager --lines=0 status "$UNIT"
printf 'Deployment completed on port %s.\n' "$PORT"
REMOTE
)

remote() {
  ssh "${SSH_OPTIONS[@]}" "root@$HOST" "bash -s -- $*" <<< "$REMOTE_SCRIPT"
}

# Reuse one authenticated connection for checks, uploads, and installation.
# The private socket is unique to this invocation and closed on every exit.
umask 077
TEMP_DIR=$(mktemp -d)
UPLOAD_CREATED=0
SSH_OPTIONS+=(-o ControlMaster=auto -o ControlPersist=60 -o "ControlPath=$TEMP_DIR/control")
SCP_OPTIONS+=(-o ControlMaster=auto -o ControlPersist=60 -o "ControlPath=$TEMP_DIR/control")
cleanup_local() {
  local status=$?
  trap - EXIT
  if ((UPLOAD_CREATED)); then
    remote cleanup "$PORT" "$RELEASE" >/dev/null 2>&1 || printf 'Could not remove this upload directory; it remains private on the server.\n' >&2
  fi
  if [[ -S "$TEMP_DIR/control" ]]; then
    ssh "${SSH_OPTIONS[@]}" -O exit "root@$HOST" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$TEMP_DIR"
  exit "$status"
}
trap cleanup_local EXIT

printf 'Checking %s without changing the server…\n' "$HOST"
remote check "$PORT"
((CHECK_ONLY)) && exit 0

for command in node npm scp tar; do command -v "$command" >/dev/null || fail "Missing local command: $command."; done
cd "$ROOT_DIR"
if ((!SKIP_BUILD)); then npm run build; fi
[[ -f apps/web/dist/index.html ]] || fail "No frontend build found. Run npm run build first."
[[ -f apps/api/.env ]] || fail "Add GROQ_API_KEY to apps/api/.env before deploying."
# Parse dotenv with Node rather than executing it. Only these two values leave
# this computer; neither the key nor the full local environment is printed.
node --input-type=module - "$ROOT_DIR/apps/api/.env" "$TEMP_DIR/api.env" <<'JS'
import { loadEnvFile } from "node:process";
import { writeFileSync } from "node:fs";
delete process.env.GROQ_API_KEY;
delete process.env.GROQ_MODEL;
try { loadEnvFile(process.argv[2]); }
catch { console.error("Cannot parse apps/api/.env."); process.exit(1); }
const rawKey = process.env.GROQ_API_KEY || "";
const rawModel = process.env.GROQ_MODEL || "";
const key = rawKey.trim();
const model = rawModel.trim() || "openai/gpt-oss-20b";
if (/[\r\n\0]/.test(rawKey + rawModel) || !key || !/^[A-Za-z0-9._-]+$/.test(key) || !/^[A-Za-z0-9._/-]+$/.test(model)) {
  console.error("GROQ_API_KEY and GROQ_MODEL must contain valid single-line values.");
  process.exit(1);
}
writeFileSync(process.argv[3], `GROQ_API_KEY=${key}\nGROQ_MODEL=${model}\n`, { mode: 0o600, flag: "wx" });
JS

tar -czf "$TEMP_DIR/release.tar.gz" \
  --exclude='*.test.ts' --exclude='__tests__' --exclude='.env*' \
  --exclude='node_modules' --exclude='.git' \
  package.json package-lock.json tsconfig.base.json \
  apps/api/package.json apps/api/src apps/web/package.json apps/web/dist \
  packages/shared/package.json packages/shared/src
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$$-$RANDOM"
printf 'Uploading a private release…\n'
remote prepare "$PORT" "$RELEASE"
UPLOAD_CREATED=1
scp "${SCP_OPTIONS[@]}" "$TEMP_DIR/release.tar.gz" "$TEMP_DIR/api.env" "root@$HOST:/opt/prompt-studio/.incoming-$RELEASE/"
remote deploy "$PORT" "$RELEASE"
UPLOAD_CREATED=0
printf '\nApp URL: http://%s:%s/\n' "$HOST" "$PORT"
