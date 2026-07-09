#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_REPO="$(cd "${SCRIPT_DIR}/.." && pwd)"
JEMACS_DIR="${JEMACS_DIR:-${HOME}/.jemacs}"
INIT_PATH="${JEMACS_INIT_PATH:-${JEMACS_DIR}/init.ts}"
DATA_HOME="${XDG_DATA_HOME:-${HOME}/.local/share}"
JEMACS_HOME="${JEMACS_HOME:-${DATA_HOME}/jemacs}"

mkdir -p "${JEMACS_DIR}"

if [[ -e "${INIT_PATH}" && ! -L "${INIT_PATH}" ]]; then
  echo "jemacs config: refusing to replace ${INIT_PATH}; move it or set JEMACS_INIT_PATH" >&2
  exit 1
fi

mkdir -p "$(dirname "${INIT_PATH}")"
ln -sfn "${CONFIG_REPO}/install.ts" "${INIT_PATH}"

# Give editors/typecheckers a stable public API path without a sibling checkout.
if [[ -f "${JEMACS_HOME}/packages/jemacs-core/package.json" ]]; then
  CORE_LINK="${CONFIG_REPO}/node_modules/@jemacs/core"
  mkdir -p "$(dirname "${CORE_LINK}")"
  if [[ -e "${CORE_LINK}" || -L "${CORE_LINK}" ]]; then
    rm -rf "${CORE_LINK}"
  fi
  ln -s "${JEMACS_HOME}/packages/jemacs-core" "${CORE_LINK}"
else
  echo "warn: core not found at ${JEMACS_HOME}; config was installed, but type navigation is unavailable" >&2
fi

echo "Installed Jemacs config:"
echo "  ${INIT_PATH} -> ${CONFIG_REPO}/install.ts"
