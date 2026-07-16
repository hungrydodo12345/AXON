#!/bin/bash
# Launch-AXON.command — double-click launcher for macOS.
# Finder runs .command files as shell scripts in Terminal automatically.
set -e

cd "$(dirname "$0")/.."

echo "============================================"
echo "  AXON — starting up"
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed."
  echo "Download it from https://nodejs.org (LTS version), install it, then double-click this file again."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies — this only happens once, may take a few minutes..."
  npm install
fi

if [ ! -f ".env" ]; then
  echo "First run: creating .env with sane defaults..."
  cp .env.example .env

  AUTOSECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  # Portable in-place sed for both macOS (BSD sed) and Linux (GNU sed)
  sed -i.bak "s#^AUTH_SECRET=.*#AUTH_SECRET=${AUTOSECRET}#" .env
  sed -i.bak "s#^ALLOWED_ORIGINS=.*#ALLOWED_ORIGINS=http://localhost:3001#" .env
  rm -f .env.bak

  echo "Using AXON's built-in trial AI key by default."
  echo "Want to use your own Groq or Gemini key instead? Run: npm run setup:key"
  echo
fi

echo "Launching AXON..."
npm run electron:dev

read -n 1 -s -r -p "Press any key to close..."
