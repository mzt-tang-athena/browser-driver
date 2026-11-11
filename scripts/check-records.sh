#!/usr/bin/env bash
# Check ADR and ticket names against the record naming rule.
# A good name is YYYYMMDD-short-title.md (a real local date) or a legacy
# NNNN-short-title.md. The stem is the identity, so stems must not repeat.
set -euo pipefail

root="${1:-.}"
root="${root%/}"
root="${root#./}"
[ -n "$root" ] || root="."

name_re='^([0-9]{4}|[0-9]{8})-[a-z0-9]+(-[a-z0-9]+)*\.md$'
status=0
checked=0

declare -A ticket_stems=()

report() {
    printf 'record name: %s: %s\n' "$1" "$2" >&2
    status=1
}

# Check one file name. Returns non-zero when the name is invalid.
check_name() {
    local path="$1"
    local base="${path##*/}"
    local prefix

    if ! printf '%s\n' "$base" | grep -Eq "$name_re"; then
        report "$path" "not YYYYMMDD-short-title.md or NNNN-short-title.md"
        return 1
    fi

    prefix="${base%%-*}"
    if [ "${#prefix}" -eq 8 ]; then
        # date normalizes a bad day, so a mismatch means the date never existed.
        if [ "$(date -d "$prefix" +%Y%m%d 2>/dev/null || true)" != "$prefix" ]; then
            report "$path" "date prefix $prefix is not a real date"
            return 1
        fi
    fi

    checked=$((checked + 1))
    return 0
}

check_stem() {
    local path="$1"
    local stem="${path##*/}"
    stem="${stem%.md}"

    if [ -n "${ticket_stems[$stem]:-}" ]; then
        report "$path" "duplicate ticket stem $stem"
        return
    fi
    ticket_stems[$stem]="$path"
}

check_dir() {
    local dir="$1"
    local kind="$2"
    local path base

    [ -d "$dir" ] || return 0

    shopt -s nullglob
    for path in "$dir"/*.md; do
        base="${path##*/}"
        case "$base" in
            adr-template.md|.gitkeep) continue ;;
        esac
        check_name "$path" || continue
        if [ "$kind" = ticket ]; then
            check_stem "$path"
        fi
    done
    shopt -u nullglob
}

check_dir "$root/docs/adr" adr
check_dir "$root/tickets/open" ticket
check_dir "$root/tickets/doing" ticket
check_dir "$root/tickets/done" ticket

if [ "$status" -ne 0 ]; then
    exit 1
fi

echo "record names: ok ($checked files)"
