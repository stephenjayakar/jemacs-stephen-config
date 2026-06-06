#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"
VIBE_DIR="$(cd "${CONFIG_REPO}/.." && pwd)"

JEMACS_HOME="${JEMACS_HOME:-${VIBE_DIR}/jemacs-opentui}"
PACKAGES_REPO="${JEMACS_PACKAGES:-${VIBE_DIR}/jemacs-packages}"
BIN_DIR="${BIN_DIR:-${HOME}/.local/bin}"

run_bun() {
  if command -v bun >/dev/null 2>&1; then
    bun "$@"
  else
    npx bun "$@"
  fi
}

echo "jemacs:    ${JEMACS_HOME}"
echo "config:    ${CONFIG_REPO}"
echo "packages:  ${PACKAGES_REPO}"

git -C "${JEMACS_HOME}" pull --ff-only
git -C "${CONFIG_REPO}" pull --ff-only
git -C "${PACKAGES_REPO}" pull --ff-only

cd "${JEMACS_HOME}"
run_bun install
run_bun run check || echo "warn: tsc reported errors"
if [[ "${JEMACS_DEPLOY_SKIP_TEST:-}" != "1" ]]; then
  run_bun test || echo "warn: some tests failed (set JEMACS_DEPLOY_SKIP_TEST=1 to skip)"
fi

cd "${PACKAGES_REPO}"
run_bun install

mkdir -p "${BIN_DIR}" "${HOME}/.jemacs"

chmod +x "${CONFIG_REPO}/scripts/jemacs"
ln -sf "${CONFIG_REPO}/scripts/jemacs" "${BIN_DIR}/jemacs"

ln -sf "${CONFIG_REPO}/install.ts" "${HOME}/.jemacs/init.ts"
ln -sfn "${PACKAGES_REPO}" "${HOME}/.jemacs/packages"

echo "Deployed: ${BIN_DIR}/jemacs"
echo "  init.ts -> ${HOME}/.jemacs/init.ts"
echo "  packages -> ${HOME}/.jemacs/packages"
