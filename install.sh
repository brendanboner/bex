#!/usr/bin/env bash
# Forge (BEX) — one-line installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/extremenetworks-emu/bex/main/install.sh | bash
#
# Options (env vars):
#   BEX_DIR   — install directory (default: ~/bex)
#   BEX_REPO  — git repo to clone (default: https://github.com/extremenetworks-emu/bex.git)

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

info()    { echo -e "${CYAN}  →${RESET} $*"; }
success() { echo -e "${GREEN}  ✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}  ⚠${RESET} $*"; }
error()   { echo -e "${RED}  ✗ ERROR:${RESET} $*" >&2; }
die()     { error "$*"; exit 1; }
hr()      { echo -e "${DIM}  ─────────────────────────────────────────────${RESET}"; }

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║          Forge (BEX) Installer           ║"
echo "  ║   Autonomous agents for your network     ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${RESET}"

# ── Parse args ───────────────────────────────────────────────────────────────
INSTALL_DIR="${BEX_DIR:-$HOME/bex}"
REPO="${BEX_REPO:-https://github.com/extremenetworks-emu/bex.git}"

for arg in "$@"; do
  case $arg in
    --dir=*) INSTALL_DIR="${arg#*=}" ;;
    --repo=*) REPO="${arg#*=}" ;;
    --help|-h)
      echo "Usage: bash install.sh [--dir=PATH] [--repo=URL]"
      echo ""
      echo "  --dir=PATH   Install directory (default: ~/bex)"
      echo "  --repo=URL   Git repo URL (default: GitHub)"
      exit 0
      ;;
  esac
done

# ── Prerequisite checks ───────────────────────────────────────────────────────
hr
echo -e "  ${BOLD}Checking prerequisites…${RESET}"
echo ""

# Node.js >= 20
if ! command -v node &>/dev/null; then
  die "Node.js not found. Install Node.js 20+ from https://nodejs.org and re-run."
fi
NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node.js $NODE_VER found, but version 20+ is required. https://nodejs.org"
fi
success "Node.js $NODE_VER"

# npm
if ! command -v npm &>/dev/null; then
  die "npm not found. It should come with Node.js."
fi
NPM_VER=$(npm --version)
success "npm $NPM_VER"

# Git
if ! command -v git &>/dev/null; then
  die "git not found. Install git and re-run."
fi
success "git $(git --version | awk '{print $3}')"

# Docker
if ! command -v docker &>/dev/null; then
  die "Docker not found. Install Docker Desktop (https://docs.docker.com/get-docker/) and re-run."
fi
if ! docker info &>/dev/null 2>&1; then
  die "Docker is installed but not running. Start Docker Desktop and re-run."
fi
DOCKER_VER=$(docker --version | awk '{print $3}' | tr -d ',')
success "Docker $DOCKER_VER (running)"

echo ""

# ── Clone or update ──────────────────────────────────────────────────────────
hr
if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "  ${BOLD}Updating existing install at $INSTALL_DIR …${RESET}"
  echo ""
  cd "$INSTALL_DIR"
  info "Pulling latest changes…"
  git pull --ff-only || warn "Could not fast-forward — local changes may be present. Skipping pull."
else
  echo -e "  ${BOLD}Installing to $INSTALL_DIR …${RESET}"
  echo ""
  if [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    die "Directory $INSTALL_DIR exists and is not empty. Use --dir=PATH to choose a different location."
  fi
  info "Cloning repository…"
  git clone --depth=1 "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
success "Source ready at $INSTALL_DIR"
echo ""

# ── Build ────────────────────────────────────────────────────────────────────
hr
echo -e "  ${BOLD}Building Forge…${RESET}"
echo -e "  ${DIM}(this takes ~60s on first run)${RESET}"
echo ""

info "Installing dependencies…"
npm install --no-audit --no-fund --silent 2>&1 | grep -Ev "^npm (warn|notice)" | grep -v "^$" || true

info "Building all packages…"
npm run build --silent 2>&1 | grep -E "Tasks:|error" | head -5 || true

info "Linking bex CLI globally…"
chmod +x packages/cli/dist/bin/bex.js
(cd packages/cli && npm link --force --loglevel=error --no-audit > /dev/null 2>&1)

success "Build complete"
echo ""

# ── PATH check ───────────────────────────────────────────────────────────────
NPM_BIN=$(npm bin -g 2>/dev/null || npm root -g 2>/dev/null | xargs dirname)
if ! command -v bex &>/dev/null; then
  warn "'bex' is not on your PATH yet."
  echo ""
  echo -e "  Add this to your shell config (${BOLD}~/.zshrc${RESET} or ${BOLD}~/.bashrc${RESET}):"
  echo ""
  echo -e "    ${CYAN}export PATH=\"$NPM_BIN:\$PATH\"${RESET}"
  echo ""
  echo -e "  Then reload your shell:"
  echo -e "    ${CYAN}source ~/.zshrc${RESET}   ${DIM}# or source ~/.bashrc${RESET}"
  echo ""

  # Auto-append if interactive shell (not piped)
  if [ -t 0 ]; then
    SHELL_RC=""
    if [ -f "$HOME/.zshrc" ]; then SHELL_RC="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"
    fi
    if [ -n "$SHELL_RC" ]; then
      read -r -p "  Add PATH entry to $SHELL_RC automatically? [Y/n] " ADD_PATH
      ADD_PATH="${ADD_PATH:-Y}"
      if [[ "$ADD_PATH" =~ ^[Yy]$ ]]; then
        echo "" >> "$SHELL_RC"
        echo "# Forge (bex) CLI" >> "$SHELL_RC"
        echo "export PATH=\"$NPM_BIN:\$PATH\"" >> "$SHELL_RC"
        success "PATH updated in $SHELL_RC"
        export PATH="$NPM_BIN:$PATH"
      fi
    fi
  else
    # Running via curl | bash — PATH not interactive, print manual instructions only
    export PATH="$NPM_BIN:$PATH"
  fi
fi

# ── Launch wizard ────────────────────────────────────────────────────────────
hr
echo ""
echo -e "  ${BOLD}${GREEN}Forge installed!${RESET} Starting setup wizard…"
echo ""

# If bex is still not on PATH from a fresh curl | bash, run via node directly
if command -v bex &>/dev/null; then
  bex init
else
  node "$INSTALL_DIR/packages/cli/dist/bin/bex.js" init
fi
