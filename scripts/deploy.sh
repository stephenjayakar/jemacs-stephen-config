#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"
VIBE_DIR="$(cd "${CONFIG_REPO}/.." && pwd)"

JEMACS_HOME="${JEMACS_HOME:-${VIBE_DIR}/jemacs-opentui}"
PACKAGES_REPO="${JEMACS_PACKAGES:-${VIBE_DIR}/jemacs-packages}"
BIN_DIR="${BIN_DIR:-${HOME}/.local/bin}"

echo "jemacs:    ${JEMACS_HOME}"
echo "config:    ${CONFIG_REPO}"
echo "packages:  ${PACKAGES_REPO}"

git -C "${JEMACS_HOME}" pull --ff-only
git -C "${CONFIG_REPO}" pull --ff-only
git -C "${PACKAGES_REPO}" pull --ff-only

cd "${JEMACS_HOME}"
bun install
bun run check
bun test

mkdir -p "${BIN_DIR}" "${HOME}/.jemacs"

cat > "${BIN_DIR}/jemacs" <<EOF
#!/usr/bin/env bash
export JEMACS_HOME="${JEMACS_HOME}"
exec bun run "\${JEMACS_HOME}/src/main.ts" "\$@"
EOF
chmod +x "${BIN_DIR}/jemacs"

ln -sf "${CONFIG_REPO}/install.ts" "${HOME}/.jemacs/init.ts"
ln -sfn "${PACKAGES_REPO}" "${HOME}/.jemacs/packages"

echo "Deployed: ${BIN_DIR}/jemacs"
echo "  init.ts -> ${HOME}/.jemacs/init.ts"
echo "  packages -> ${HOME}/.jemacs/packages"
