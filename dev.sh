#!/bin/bash
# dev.sh — deprecated wrapper. Use `bex monitor` instead.
echo ""
echo "  ⚠  dev.sh is deprecated. Please use the bex CLI:"
echo ""
echo "     bex monitor          # start services + open tmux monitor"
echo "     bex monitor --attach # re-attach to a running session"
echo "     bex monitor --stop   # stop services + close session"
echo "     bex start            # start services without a monitor view"
echo ""

if command -v bex &>/dev/null; then
  exec bex monitor "$@"
else
  echo "  bex not found in PATH."
  echo "  Install: cd packages/cli && npm install && npm run build && npm link"
  echo ""
  exit 1
fi
