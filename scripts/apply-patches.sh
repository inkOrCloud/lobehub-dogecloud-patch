#!/usr/bin/env bash
# 将 LobeHub 源码打上 DogeCloud 补丁
# 用法: ./scripts/apply-patches.sh /path/to/lobehub
set -euo pipefail

PATCHES_DIR="$(cd "$(dirname "$0")/../patches" && pwd)"
LOBECHUB_DIR="${1:-.}"

if [ ! -d "$LOBECHUB_DIR/.git" ]; then
  echo "❌ $LOBECHUB_DIR 不是一个有效的 git 仓库"
  echo "用法: $0 /path/to/lobehub"
  exit 1
fi

cd "$LOBECHUB_DIR"

# ── 应用 S3 凭证钩子补丁 ──────────────────────────────────────────────
PATCH_FILE="$PATCHES_DIR/s3-credential-hook.patch"

if git apply --check "$PATCH_FILE" 2>/dev/null; then
  git apply "$PATCH_FILE"
  echo "✓ 已应用 s3-credential-hook.patch"
else
  echo "ℹ s3-credential-hook.patch 无法应用（可能已打过），跳过"
fi

# ── 复制 DogeCloud 凭证存储文件 ──────────────────────────────────────
# 优先使用 apps/server/src/patches（v2.2+ turborepo 结构），
# 如果不存在则回退到旧版 src/server/patches
if [ -d "apps/server/src" ]; then
  DEST="apps/server/src/patches"
  ENTRY_FILE="apps/server/src/hono/index.ts"
else
  DEST="src/server/patches"
  ENTRY_FILE="src/server/hono/index.ts"
fi
mkdir -p "$DEST"
cp "$PATCHES_DIR/dogecloud-credential-store.ts" "$DEST/"
echo "✓ 已复制 dogecloud-credential-store.ts → $DEST/"

# ── 自动添加 import 到服务端入口文件 ─────────────────────────────────
if [ -f "$ENTRY_FILE" ]; then
  if ! grep -q "dogecloud-credential-store" "$ENTRY_FILE"; then
    # 在 import honoApp 之后插入凭证存储的 import
    sed -i "\|^import { Hono } from 'hono';$|a import '../patches/dogecloud-credential-store';" "$ENTRY_FILE"
    echo "✓ 已添加 import → $ENTRY_FILE"
  else
    echo "ℹ import 已存在于 $ENTRY_FILE，跳过"
  fi
else
  echo "⚠ 未找到 $ENTRY_FILE，请手动在服务端入口文件中添加:"
  echo "  import '../patches/dogecloud-credential-store';"
fi

# ── 完成 ──────────────────────────────────────────────────────────────
echo ""
echo "✅ 补丁全部应用完成"
echo ""
echo "环境变量设置:"
echo "  DOGECLOUD_ACCESS_KEY=your_access_key"
echo "  DOGECLOUD_SECRET_KEY=your_secret_key"
echo "  DOGECLOUD_BUCKET=your_bucket"
echo ""
echo "可选环境变量:"
echo "  S3_ENDPOINT=...     # 覆盖 DogeCloud API 返回的 endpoint"
echo "  S3_BUCKET=...       # 覆盖 DogeCloud API 返回的 bucket"
echo "  DOGECLOUD_CHANNEL=OSS_FULL  # OSS_FULL（默认）| OSS_UPLOAD"
echo "  DOGECLOUD_TTL=7200         # 临时密钥有效期（秒，最大7200）"
