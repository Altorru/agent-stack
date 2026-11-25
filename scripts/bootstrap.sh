#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK=0
WITH_TOOLS=0
LINK=1
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --with-tools) WITH_TOOLS=1 ;;
    --no-link) LINK=0 ;;
    --help|-h)
      cat <<'HELP'
Usage: ./scripts/bootstrap.sh [--check] [--with-tools] [--no-link]

Install locked npm dependencies, build agentctl, and add a managed launcher
under ~/.local/bin. Existing agent/provider configuration is preserved.
--check       Check requirements and upstream availability without changing files.
--with-tools  Also install missing upstream tools described in dependencies.lock.json.
--no-link     Build only; do not add ~/.local/bin/agentctl.

Requires Node.js >=22, npm, and Git. macOS and Linux are supported.
Upstream accounts/subscriptions must be connected using their native login flows.
HELP
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) printf 'Use scripts/bootstrap.ps1 on Windows, or run this script in WSL2.\n' >&2; exit 1 ;;
esac
for tool in node npm git; do
  command -v "$tool" >/dev/null 2>&1 || { printf 'Missing prerequisite: %s\n' "$tool" >&2; exit 1; }
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js >=22 is required."); process.exit(1); }'
printf 'Node %s; npm %s\n' "$(node --version)" "$(npm --version)"
if [[ "$CHECK" == 1 ]]; then
  node "$ROOT/scripts/install-upstream.mjs" --check all
  exit 0
fi

cd "$ROOT"
[[ -f package-lock.json ]] || { printf 'package-lock.json is missing; refuse an unpinned install.\n' >&2; exit 1; }
npm ci --ignore-scripts
npm run build
if [[ "$WITH_TOOLS" == 1 ]]; then
  node "$ROOT/scripts/install-upstream.mjs" --install all
fi
if [[ "$LINK" == 1 ]]; then
  node "$ROOT/scripts/link-cli.mjs" install
fi
printf '\nInstallation complete. Run: agentctl doctor\n'
if [[ ":$PATH:" != *":$HOME/.local/bin:"* && "$LINK" == 1 ]]; then
  printf 'Add ~/.local/bin to PATH in your shell, then reopen the terminal.\n'
fi
