#!/bin/bash
TARGET="/home/thegalch/"
REPO_URL="git@github.com:thegalch/live-sport-plugin.git"

# If the directory doesn't have the repo cloned yet
if [ ! -d "$TARGET/.git" ]; then
    git clone $REPO_URL $TARGET
else
    cd $TARGET
    git pull origin main
fi

# Optional: Run build commands if you use Node.js, PHP dependencies, etc.
# npm install && npm run build 
