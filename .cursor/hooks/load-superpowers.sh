#!/usr/bin/env bash
# Load the vendored Superpowers plugin when this workspace opens.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PLUGIN_PATH="${WORKSPACE_ROOT}/vendor/superpowers"

if [ ! -f "${PLUGIN_PATH}/.cursor-plugin/plugin.json" ]; then
  printf '{"pluginPaths":[]}\n'
  exit 0
fi

# Cursor accepts forward slashes on Windows.
PLUGIN_PATH="${PLUGIN_PATH//\\//}"
printf '{"pluginPaths":["%s"]}\n' "$PLUGIN_PATH"