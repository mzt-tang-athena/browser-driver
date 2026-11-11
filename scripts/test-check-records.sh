#!/usr/bin/env bash
# Exercise check-records.sh and hooks/commit-msg against fixture roots.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checker="$here/check-records.sh"
hook="$here/../hooks/commit-msg"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

assertions=0

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

run_check() {
    set +e
    out="$("$checker" "$1" 2>"$tmp/stderr")"
    code=$?
    set -e
    err="$(cat "$tmp/stderr")"
}

# pass_case <label> <fixture-root> [exact stdout]
pass_case() {
    local label="$1" dir="$2" want_out="${3:-}"
    run_check "$dir"
    [ "$code" -eq 0 ] || fail "$label: expected exit 0, got $code; stderr: $err"
    case "$out" in
        'record names: ok ('*' files)') ;;
        *) fail "$label: unexpected stdout: $out" ;;
    esac
    if [ -n "$want_out" ] && [ "$out" != "$want_out" ]; then
        fail "$label: expected '$want_out', got '$out'"
    fi
    assertions=$((assertions + 1))
}

# fail_case <label> <fixture-root> <path that stderr must name>
fail_case() {
    local label="$1" dir="$2" want="$3"
    run_check "$dir"
    [ "$code" -eq 1 ] || fail "$label: expected exit 1, got $code; stderr: $err"
    case "$err" in
        *"$want"*) ;;
        *) fail "$label: stderr does not name $want: $err" ;;
    esac
    case "$err" in
        'record name: '*) ;;
        *) fail "$label: stderr missing the record name prefix: $err" ;;
    esac
    assertions=$((assertions + 1))
}

# hook_case <label> <message body> <expected exit>
hook_case() {
    local label="$1" body="$2" want="$3"
    printf '%s\n' "$body" > "$tmp/message"
    set +e
    out="$("$hook" "$tmp/message" 2>&1)"
    code=$?
    set -e
    [ "$code" -eq "$want" ] || fail "$label: expected exit $want, got $code: $out"
    assertions=$((assertions + 1))
}

fixture() {
    mkdir -p "$tmp/$1"
    printf '%s\n' "$tmp/$1"
}

# New and legacy names pass, and the template is not a record.
dir="$(fixture adr-new)"
mkdir -p "$dir/docs/adr"
touch "$dir/docs/adr/20261111-pick-a-name.md"
pass_case "new ADR" "$dir" "record names: ok (1 files)"

dir="$(fixture adr-legacy)"
mkdir -p "$dir/docs/adr"
touch "$dir/docs/adr/0042-pick-a-name.md"
pass_case "legacy ADR" "$dir"

dir="$(fixture template-only)"
mkdir -p "$dir/docs/adr"
touch "$dir/docs/adr/adr-template.md"
pass_case "template ignored" "$dir" "record names: ok (0 files)"

dir="$(fixture ticket-new)"
mkdir -p "$dir/tickets/open"
touch "$dir/tickets/open/20261111-pick-a-name.md"
pass_case "new ticket" "$dir"

dir="$(fixture ticket-legacy)"
mkdir -p "$dir/tickets/done"
touch "$dir/tickets/done/0007-pick-a-name.md"
pass_case "legacy ticket" "$dir"

dir="$(fixture no-prefix)"
mkdir -p "$dir/tickets/open"
touch "$dir/tickets/open/pick-a-name.md"
fail_case "name without a prefix" "$dir" "tickets/open/pick-a-name.md"

dir="$(fixture bad-date)"
mkdir -p "$dir/docs/adr"
touch "$dir/docs/adr/20261301-pick-a-name.md"
fail_case "impossible date" "$dir" "docs/adr/20261301-pick-a-name.md"

dir="$(fixture upper-slug)"
mkdir -p "$dir/docs/adr"
touch "$dir/docs/adr/20261111-Pick-A-Name.md"
fail_case "uppercase slug" "$dir" "docs/adr/20261111-Pick-A-Name.md"

dir="$(fixture duplicate-stem)"
mkdir -p "$dir/tickets/open" "$dir/tickets/done"
touch "$dir/tickets/open/0002-pick-a-name.md" "$dir/tickets/done/0002-pick-a-name.md"
fail_case "duplicate stem across ticket folders" "$dir" "tickets/done/0002-pick-a-name.md"

hook_case "agent co-author trailer" "feat: add a thing

Co-authored-by: Claude <noreply@anthropic.com>" 1
hook_case "clean message" "feat: add a thing" 0

printf 'check-records: %s assertions passed\n' "$assertions"
