#!/usr/bin/env bash
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

if command -v pwsh >/dev/null 2>&1; then
  pwsh_bin=$(command -v pwsh)
elif [ -x "$repo_root/.tools/powershell/pwsh" ]; then
  pwsh_bin="$repo_root/.tools/powershell/pwsh"
else
  echo "PowerShell 7 was not found." >&2
  echo "Install pwsh or extract the official binary into .tools/powershell." >&2
  exit 127
fi

exec "$pwsh_bin" -NoProfile -File "$@"
