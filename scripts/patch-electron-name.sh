#!/bin/bash
# Patch Electron.app so macOS dock/menu shows "Testnizer" in dev mode
APP_DIR="node_modules/electron/dist/Electron.app"
RENAMED_DIR="node_modules/electron/dist/Testnizer.app"
OLD_RENAMED_DIR="node_modules/electron/dist/Apinizer.app"
OLD_RENAMED_DIR2="node_modules/electron/dist/Apinizer API Tester.app"
PLIST="$APP_DIR/Contents/Info.plist"

# If already renamed (new or old names), use that path
if [ -d "$RENAMED_DIR" ]; then
  APP_DIR="$RENAMED_DIR"
  PLIST="$APP_DIR/Contents/Info.plist"
elif [ -d "$OLD_RENAMED_DIR" ]; then
  APP_DIR="$OLD_RENAMED_DIR"
  PLIST="$APP_DIR/Contents/Info.plist"
elif [ -d "$OLD_RENAMED_DIR2" ]; then
  APP_DIR="$OLD_RENAMED_DIR2"
  PLIST="$APP_DIR/Contents/Info.plist"
fi

if [ -f "$PLIST" ]; then
  plutil -replace CFBundleDisplayName -string "Testnizer" "$PLIST"
  plutil -replace CFBundleName -string "Testnizer" "$PLIST"
  plutil -replace CFBundleIdentifier -string "com.testnizer.app" "$PLIST"
  echo "Patched Info.plist"
fi

# Patch all Helper apps too
for HELPER in "$APP_DIR/Contents/Frameworks/Electron Helper"*.app; do
  HPLIST="$HELPER/Contents/Info.plist"
  if [ -f "$HPLIST" ]; then
    plutil -replace CFBundleName -string "Testnizer Helper" "$HPLIST"
    echo "Patched $(basename "$HELPER") Info.plist"
  fi
done

# Rename the .app bundle itself so macOS dock tooltip shows correct name
if [ -d "node_modules/electron/dist/Electron.app" ]; then
  mv "node_modules/electron/dist/Electron.app" "$RENAMED_DIR"
  echo "Renamed Electron.app → Testnizer.app"
elif [ -d "$OLD_RENAMED_DIR" ]; then
  mv "$OLD_RENAMED_DIR" "$RENAMED_DIR"
  echo "Renamed Apinizer.app → Testnizer.app"
elif [ -d "$OLD_RENAMED_DIR2" ]; then
  mv "$OLD_RENAMED_DIR2" "$RENAMED_DIR"
  echo "Renamed Apinizer API Tester.app → Testnizer.app"
fi

# Flush macOS Launch Services cache so the new name takes effect
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -kill -r -domain local -domain user 2>/dev/null
fi

# Patch electron-vite log messages to show "Testnizer" instead of "electron app"
EV_DIR="node_modules/electron-vite/dist"
if [ -d "$EV_DIR" ]; then
  find "$EV_DIR" -type f \( -name "*.mjs" -o -name "*.cjs" \) -exec \
    sed -i '' 's/start electron app\.\.\./start Testnizer.../g; s/restart electron app\.\.\./restart Testnizer.../g' {} +
  echo "Patched electron-vite log messages"
fi

# Patch electron's path.txt so it finds the renamed .app
ELECTRON_PATH="node_modules/electron/path.txt"
if [ -f "$ELECTRON_PATH" ]; then
  # Handle original and previous renamed paths
  sed -i '' 's|Electron\.app|Testnizer.app|g; s|Apinizer API Tester\.app|Testnizer.app|g; s|Apinizer\.app|Testnizer.app|g' "$ELECTRON_PATH"
  echo "Patched electron/path.txt"
fi

echo "Done — restart the app for changes to take effect"
