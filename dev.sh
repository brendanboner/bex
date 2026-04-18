#!/bin/bash
# dev.sh — deprecated wrapper. Use `bforge monitor` instead.
echo ""
echo "  ⚠  dev.sh is deprecated. Please use the bforge CLI:"
echo ""
echo "     bforge monitor          # start services + open tmux monitor"
echo "     bforge monitor --attach # re-attach to a running session"
echo "     bforge monitor --stop   # stop services + close session"
echo "     bforge start            # start services without a monitor view"
echo ""

if command -v bforge &>/dev/null; then
  exec bforge monitor "$@"
else
  echo "  bforge not found in PATH."
  echo "  Install: cd packages/cli && npm install && npm run build && npm link"
  echo ""
  exit 1
fi
