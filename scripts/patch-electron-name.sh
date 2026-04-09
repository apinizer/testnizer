#!/bin/bash
# Patch Electron.app Info.plist so macOS dock/menu shows "Apinizer API Tester" in dev mode
APP_DIR="node_modules/electron/dist/Electron.app"
PLIST="$APP_DIR/Contents/Info.plist"

if [ -f "$PLIST" ]; then
  plutil -replace CFBundleDisplayName -string "Apinizer API Tester" "$PLIST"
  plutil -replace CFBundleName -string "Apinizer API Tester" "$PLIST"
  plutil -replace CFBundleIdentifier -string "com.apinizer.api-tester" "$PLIST"
  echo "Patched Electron.app Info.plist"
fi

# Patch all Helper apps too
for HELPER in "$APP_DIR/Contents/Frameworks/Electron Helper"*.app; do
  HPLIST="$HELPER/Contents/Info.plist"
  if [ -f "$HPLIST" ]; then
    plutil -replace CFBundleName -string "Apinizer API Tester Helper" "$HPLIST"
    echo "Patched $(basename "$HELPER") Info.plist"
  fi
done

# Flush macOS Launch Services cache so the new name takes effect
if command -v lsregister &>/dev/null; then
  lsregister -kill -r -domain local -domain user 2>/dev/null
elif [ -x "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" ]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain user 2>/dev/null
fi

# Patch electron-vite log messages to show "Apinizer" instead of "electron app"
EV_DIR="node_modules/electron-vite/dist"
if [ -d "$EV_DIR" ]; then
  find "$EV_DIR" -type f \( -name "*.mjs" -o -name "*.cjs" \) -exec \
    sed -i '' 's/start electron app\.\.\./start Apinizer.../g; s/restart electron app\.\.\./restart Apinizer.../g' {} +
  echo "Patched electron-vite log messages"
fi

echo "Done — restart the app for changes to take effect"
