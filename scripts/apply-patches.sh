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

# 应用 S3 凭证钩子补丁 ---
PATCH_FILE="$PATCHES_DIR/s3-credential-hook.patch"

if git apply --check "$PATCH_FILE" 2>/dev/null; then
  git apply "$PATCH_FILE"
  echo "✓ 已应用 s3-credential-hook.patch"
else
  echo "ℹ s3-credential-hook.patch 无法应用（可能已打过），跳过"
fi

# 复制 DogeCloud 凭证存储 ---
# 优先使用 apps/server/src/patches（v2.2+ turborepo 结构），
# 如果不存在则回退到旧版 src/server/patches
if [ -d "apps/server/src" ]; then
  DEST="apps/server/src/patches"
else
  DEST="src/server/patches"
fi
mkdir -p "$DEST"
cp "$PATCHES_DIR/dogecloud-credential-store.ts" "$DEST/"
echo "✓ 已复制 dogecloud-credential-store.ts → $DEST/"

echo ""
echo "✅ 补丁全部应用完成"
echo ""
echo "下一步: 在 LobeHub 服务端入口文件（如 apps/server/src/hono/standalone.ts）中添加:"
echo "  import '../patches/dogecloud-credential-store';"
echo ""
echo "环境变量设置:"
echo "  DOGECLOUD_ACCESS_KEY=your_access_key"
echo "  DOGECLOUD_SECRET_KEY=your_secret_key"
echo "  DOGECLOUD_BUCKET=your_bucket"
