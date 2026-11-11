#!/usr/bin/env bash
# Worktree setup for browser-driver.
# Called after a linked worktree is created, by any harness.
set -euo pipefail

# Refuse to run in the main checkout.
git_dir="$(cd "$(git rev-parse --git-dir)" && pwd -P)"
common_dir="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
if [ "$git_dir" = "$common_dir" ]; then
    echo "worktree-setup: not a linked worktree; nothing to do"
    exit 0
fi

main_path="$(git worktree list --porcelain | awk '/^worktree / {print $2; exit}')"
worktree_path="$(pwd -P)"
worktree_name="$(basename "$worktree_path")"

# Copy local files listed in .worktreeinclude.
if [ -f .worktreeinclude ]; then
    while IFS= read -r entry; do
        entry="${entry%%#*}"
        entry="$(printf '%s' "$entry" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$entry" ] || continue
        case "$entry" in
            /*|*..*)
                echo "worktree-setup: skip unsafe path: $entry" >&2
                continue
                ;;
        esac
        if [ -e "$main_path/$entry" ] && [ ! -e "$entry" ]; then
            mkdir -p "$(dirname "$entry")"
            cp -a "$main_path/$entry" "$entry"
            echo "worktree-setup: copied $entry"
        fi
    done < .worktreeinclude
fi

# Pick a free port. The hash keeps it stable for the same worktree path.
port="$(python3 - "$worktree_path" <<'PY'
import hashlib
import socket
import sys

path = sys.argv[1]
start = 3100 + int(hashlib.sha256(path.encode()).hexdigest(), 16) % 800
for offset in range(800):
    candidate = 3100 + (start - 3100 + offset) % 800
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", candidate))
        except OSError:
            continue
        print(candidate)
        break
else:
    raise SystemExit("worktree-setup: no free port in 3100-3899")
PY
)"

{
    printf 'WORKTREE_NAME=%s\n' "$worktree_name"
    printf 'WORKTREE_PATH=%s\n' "$worktree_path"
    printf 'MAIN_PATH=%s\n' "$main_path"
    printf 'PORT=%s\n' "$port"
} > .worktree.env

git config --local core.hooksPath hooks
echo "worktree-setup: core.hooksPath set to hooks"

echo "worktree-setup: $worktree_name on port $port"

# Dependencies. The lockfile is committed; npm ci is reproducible.
if [ ! -d node_modules ]; then
    npm ci
fi

# The service reads BROWSER_DRIVER_PORT from .env or the environment.
touch .env
if grep -q '^BROWSER_DRIVER_PORT=' .env; then
    sed -i "s/^BROWSER_DRIVER_PORT=.*/BROWSER_DRIVER_PORT=$port/" .env
else
    printf 'BROWSER_DRIVER_PORT=%s\n' "$port" >> .env
fi
