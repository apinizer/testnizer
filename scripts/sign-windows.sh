#!/usr/bin/env bash
#
# Manually Authenticode-sign a Testnizer Windows release using the Certum
# Open Source code-signing certificate held in the SimplySign cloud HSM.
#
# WHY MANUAL: SimplySign cloud signing needs a TOTP 2FA per session (2-hour
# window). Automating that in CI would mean storing the TOTP seed as a secret —
# which defeats the 2FA and is unacceptable for a PUBLIC repo. So signing is a
# human-in-the-loop step at release time. NO secret is required by, or stored
# in, this script or the repo: you authenticate interactively in SimplySign
# Desktop; the cert lives in the cloud; only the PUBLIC intermediate CA cert is
# committed (resources/certs/ccsca2021.pem).
#
# PREREQUISITES (one-time, macOS):
#   brew install osslsigncode opensc libp11
#   Install "SimplySign Desktop" + "proCertumSmartSign" (Certum).
#   Install the SimplySign mobile app (for the OTP).
#
# EACH RELEASE:
#   1. Open SimplySign Desktop → log in with your SimplySign ID + mobile OTP
#      (opens a ~2h signing window; the virtual cloud card becomes available).
#   2. Run:  scripts/sign-windows.sh v1.4.20
#      → downloads the release's unsigned .exe + latest.yml, signs every .exe
#        (SHA-256 + Certum timestamp + embedded intermediate chain), rebuilds
#        latest.yml's hashes, and (after you confirm) uploads them back.
#
# Verifies each signature before upload; refuses to proceed if the SimplySign
# session is not active.
set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" || "$TAG" == -* ]]; then
  echo "Usage: $0 <release-tag>      e.g.  $0 v1.4.20"
  exit 1
fi

REPO="apinizer/testnizer"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INTERMEDIATE="$ROOT/resources/certs/ccsca2021.pem"   # public Certum Code Signing 2021 CA
TS_URL="http://time.certum.pl/"

# SimplySign cloud PKCS#11 module (override with SIMPLYSIGN_PKCS11 if installed elsewhere).
PKCS11_MODULE="${SIMPLYSIGN_PKCS11:-/usr/local/lib/libSimplySignPKCS.dylib}"

# osslsigncode (OpenSSL 3) loads the PKCS#11 engine from these dirs; libp11
# installs it under the Homebrew prefix, which OpenSSL doesn't search by default.
BREW_PREFIX="$(brew --prefix 2>/dev/null || echo /opt/homebrew)"
export OPENSSL_ENGINES="${OPENSSL_ENGINES:-$BREW_PREFIX/lib/engines-3}"
export OPENSSL_MODULES="${OPENSSL_MODULES:-$BREW_PREFIX/lib/ossl-modules}"

die() { echo "❌ $*" >&2; exit 1; }

# ── preconditions ──────────────────────────────────────────────────────────
command -v osslsigncode >/dev/null || die "osslsigncode yok →  brew install osslsigncode"
command -v pkcs11-tool  >/dev/null || die "pkcs11-tool yok →  brew install opensc"
command -v gh           >/dev/null || die "gh yok →  brew install gh"
[[ -f "$INTERMEDIATE" ]]   || die "intermediate cert yok: $INTERMEDIATE"
[[ -f "$PKCS11_MODULE" ]]  || die "SimplySign PKCS#11 modülü yok: $PKCS11_MODULE (SimplySign Desktop kurulu mu?)"
[[ -f "$OPENSSL_ENGINES/pkcs11.dylib" ]] || die "pkcs11 engine yok: $OPENSSL_ENGINES/pkcs11.dylib →  brew install libp11"

# ── SimplySign session must be live (token visible) ─────────────────────────
if ! pkcs11-tool --module "$PKCS11_MODULE" -T 2>/dev/null | grep -q "Code Signing"; then
  die "SimplySign oturumu aktif değil. SimplySign Desktop'ı aç, ID + mobil OTP ile login ol, tekrar dene."
fi

# ── discover the signing cert's PKCS#11 id (NOT hardcoded → survives renewal) ─
CERT_ID_RAW="$(pkcs11-tool --module "$PKCS11_MODULE" -O --type cert 2>/dev/null \
  | grep -m1 -E '^[[:space:]]*ID:' | sed -E 's/.*ID:[[:space:]]*//' | tr -d '[:space:]')"
[[ -n "$CERT_ID_RAW" ]] || die "Token'da sertifika bulunamadı."
ID_URI="%$(printf '%s' "$CERT_ID_RAW" | sed 's/:/%/g')"   # 22:46:.. → %22%46%..
echo "ℹ️  Token cert id: $CERT_ID_RAW"

CERT_URI="pkcs11:token=Code%20Signing;id=$ID_URI;type=cert"
KEY_URI="pkcs11:token=Code%20Signing;id=$ID_URI;type=private"

# ── fetch the release's unsigned installers + manifest ──────────────────────
WORK="$(mktemp -d -t testnizer-sign-XXXXXX)"
UNSIGNED="$WORK/unsigned"; SIGNED="$WORK/signed"
mkdir -p "$UNSIGNED" "$SIGNED"
echo "ℹ️  $TAG asset'leri indiriliyor → $WORK"
gh release download "$TAG" --repo "$REPO" --dir "$UNSIGNED" --pattern '*.exe' --pattern 'latest.yml'

shopt -s nullglob
exes=("$UNSIGNED"/*.exe)
[[ ${#exes[@]} -gt 0 ]] || die "$TAG release'inde .exe bulunamadı."

# ── sign + verify each .exe into signed/ (same basename) ────────────────────
for exe in "${exes[@]}"; do
  base="$(basename "$exe")"
  out="$SIGNED/$base"
  echo "🔏 $base"
  osslsigncode sign \
    -pkcs11module "$PKCS11_MODULE" \
    -pkcs11cert "$CERT_URI" \
    -key "$KEY_URI" \
    -ac "$INTERMEDIATE" \
    -h sha256 -t "$TS_URL" \
    -n "Testnizer" -i "https://www.testnizer.com" \
    -in "$exe" -out "$out" >/dev/null
  if ! osslsigncode verify "$out" 2>&1 | grep -q "Signature verification: ok"; then
    osslsigncode verify "$out" 2>&1 | tail -20
    die "İmza doğrulaması başarısız: $base"
  fi
  echo "   ✅ imzalandı + doğrulandı"
done

# ── rebuild latest.yml hashes for the signed files ──────────────────────────
HAS_YML=0
if [[ -f "$UNSIGNED/latest.yml" ]]; then
  cp "$UNSIGNED/latest.yml" "$SIGNED/latest.yml"
  echo "🔁 latest.yml yeniden hesaplanıyor"
  node "$SCRIPT_DIR/patch-latest-yml.mjs" "$SIGNED/latest.yml" "$SIGNED"
  HAS_YML=1
else
  echo "⚠️  latest.yml release'de yok — yalnızca .exe imzalanacak (auto-update manifesti elle güncellenmeli)."
fi

# ── confirm, then upload (outward-facing → explicit y/N) ─────────────────────
echo ""
echo "İmzalanan dosyalar ($SIGNED):"
ls -1 "$SIGNED"
echo ""
read -r -p "Bunları '$TAG' release'ine yükle (--clobber)? [y/N] " ans
if [[ "$ans" =~ ^[Yy]$ ]]; then
  upload=("$SIGNED"/*.exe)
  [[ $HAS_YML -eq 1 ]] && upload+=("$SIGNED/latest.yml")
  gh release upload "$TAG" --repo "$REPO" --clobber "${upload[@]}"
  echo "✅ Yüklendi: $TAG"
  echo "ℹ️  Doğrula: indirip Windows'ta SmartScreen 'unknown publisher' çıkmamalı; auto-update sha512 latest.yml ile eşleşmeli."
else
  echo "⏭️  Upload atlandı. İmzalı dosyalar burada: $SIGNED"
  echo "    Elle yüklemek için:  gh release upload $TAG --repo $REPO --clobber $SIGNED/*.exe${HAS_YML:+ $SIGNED/latest.yml}"
fi
