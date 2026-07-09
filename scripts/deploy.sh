#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible name. Core and packages now have independent installers;
# this repository only installs the user config it owns.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/install.sh" "$@"
