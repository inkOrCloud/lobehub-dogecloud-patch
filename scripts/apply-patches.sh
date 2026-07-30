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

# ── 应用 file-env-fix.patch（允许空的 S3_ENDPOINT）─────────────────
PATCH_FILE2="$PATCHES_DIR/file-env-fix.patch"

if git apply --check "$PATCH_FILE2" 2>/dev/null; then
  git apply "$PATCH_FILE2"
  echo "✓ 已应用 file-env-fix.patch"
else
  echo "ℹ file-env-fix.patch 无法应用（可能已打过），跳过"
fi

# ── 复制 DogeCloud 凭证存储文件 ──────────────────────────────────────
# 优先使用 apps/server/src/patches（v2.2+ turborepo 结构），
# 如果不存在则回退到旧版 src/server/patches
if [ -d "apps/server/src" ]; then
  DEST="apps/server/src/patches"
  S3_FILE="apps/server/src/modules/S3/index.ts"
else
  DEST="src/server/patches"
  S3_FILE="src/server/modules/S3/index.ts"
fi
mkdir -p "$DEST"
cp "$PATCHES_DIR/dogecloud-credential-store.ts" "$DEST/"
echo "✓ 已复制 dogecloud-credential-store.ts → $DEST/"

# ── 自动添加 import 到 S3 模块（编译进 Docker 镜像）───────────────────
if [ -f "$S3_FILE" ]; then
  if ! grep -q "dogecloud-credential-store" "$S3_FILE"; then
    # 在 credential provider hook 之后插入凭证存储的 import
    sed -i "\|^import { YEAR }|a import '../../patches/dogecloud-credential-store';" "$S3_FILE"
    echo "✓ 已添加 import → $S3_FILE"
  else
    echo "ℹ import 已存在于 $S3_FILE，跳过"
  fi
else
  echo "⚠ 未找到 $S3_FILE，请手动在 S3 模块中添加:"
  echo "  import '../../patches/dogecloud-credential-store';"
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
