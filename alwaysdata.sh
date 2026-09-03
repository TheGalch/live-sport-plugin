#!/bin/bash

# Alwaysdata Auto-Deployment & Runner Script
# This script is meant to be run directly as the 'Command' in the Alwaysdata panel.

REPO_DIR="$HOME/live-sport-plugin"

echo "======================================"
echo "🚀 Nuvio Live Sports - Alwaysdata Runner"
echo "======================================"

# 1. Clone or Pull the latest code
if [ ! -d "$REPO_DIR" ]; then
    echo "[1/3] Cloning repository..."
    git clone https://github.com/TheGalch/live-sport-plugin.git "$REPO_DIR"
else
    echo "[1/3] Updating repository..."
    cd "$REPO_DIR"
    # Discard any local changes and pull the latest
    git reset --hard HEAD
    git pull origin main
fi

# 2. Install dependencies for the resolver
echo "[2/3] Installing resolver dependencies..."
cd "$REPO_DIR/resolver"
npm install --omit=dev --no-audit --no-fund

# 3. Start the application
echo "[3/3] Starting Nuvio Live Sports..."
cd "$REPO_DIR"
# The Node process replaces this bash script so signals are handled correctly
exec npm start