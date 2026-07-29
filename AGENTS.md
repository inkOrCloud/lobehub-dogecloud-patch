# Repository Guidelines

## Project Structure & Module Organization

```
├── patches/
│   ├── s3-credential-hook.patch          # Patch to add setCredentialProvider hook in LobeHub S3 module
│   └── dogecloud-credential-store.ts     # DogeCloud STS credential provider (copied into LobeHub at build)
├── scripts/
│   └── apply-patches.sh                  # One-click script to apply patches to a LobeHub checkout
├── .github/workflows/
│   ├── monitor-lobehub.yml               # A: 监控 LobeHub 新 tag → 触发 B
│   ├── apply-patches.yml                 # B: 克隆 + 打补丁 + 上传 artifact → 触发 C/D
│   ├── release-source.yml                # C: 从 artifact 生成 tar.gz → 发布到 Releases
│   └── build-image.yml                   # D: 从 artifact 构建 Docker 镜像 → 推送 GHCR
├── README.md                             # Full documentation
└── AGENTS.md                             # This file
```

- **`patches/`** — Patch files and supplementary source that get applied/copied into LobeHub at build time.
- **`scripts/`** — Automation scripts for applying patches locally.
- **`.github/workflows/`** — GitHub Actions CI/CD workflows.

## GitHub Actions Workflows（四阶段流水线架构）

四条工作流按 **A → B → C/D** 链式触发，形成完整的自动化流水线：

```
A (Monitor LobeHub)
  │   每 6 小时检查 lobehub/lobe-chat 新 tag
  │   发现新 tag → 触发 B
  ▼
B (Apply Patches)
  │   克隆指定 tag 源码 → 应用补丁 → 上传 artifact
  │   触发 C + D（并行）
  ├──────────────────┐
  ▼                  ▼
C (Release Source)  D (Build Docker Image)
  从 artifact 打包    从 artifact 构建
  tar.gz 并发布到      Docker 镜像并推
  GitHub Releases     送到 GHCR
```

### A — `monitor-lobehub.yml`（监控触发器）
- **触发方式**: `schedule`（每 6 小时）或 `workflow_dispatch`（手动）
- **功能**: 检查 `lobehub/lobe-chat` 最新 release tag → 比对是否已处理过（查 Release + 近期 run）→ 若为新 tag 则触发 B
- **权限**: `contents: read`, `workflows: write`

### B — `apply-patches.yml`（打补丁 + 分发）
- **触发方式**: `workflow_dispatch`（由 A 触发，也支持手动）
- **输入**: `lobehub_tag`（必填）
- **功能**: 校验最低版本 → 克隆 LobeHub → 应用补丁 → 上传 artifact（7天保留）→ 触发 C + D
- **权限**: `contents: read`, `actions: write`, `workflows: write`

### C — `release-source.yml`（发布源码）
- **触发方式**: `workflow_dispatch`（由 B 触发，也支持手动）
- **输入**: `lobehub_tag`, `artifact_run_id`
- **功能**: 从 B 的 run 下载 artifact → 打包 tar.gz → 创建/更新 GitHub Release（tag: `patched-<tag>`）
- **权限**: `actions: read`, `contents: write`

### D — `build-image.yml`（构建 Docker 镜像）
- **触发方式**: `workflow_dispatch`（由 B 触发，也支持手动）
- **输入**: `lobehub_tag`, `artifact_run_id`
- **功能**: 从 B 的 run 下载 artifact → 构建 Docker 镜像 → 推送到 `ghcr.io/inkOrCloud/lobehub-dogecloud-patch`
- **Tags 推送**: `latest`, `<semver>`, `<major>.<minor>`
- **Secrets**: `GHCR_PAT`（可选，fallback 到 `GITHUB_TOKEN`）
- **权限**: `actions: read`, `contents: read`, `packages: write`

## Build, Test, and Development Commands

```bash
# Apply patches to a local LobeHub clone
bash scripts/apply-patches.sh /path/to/lobe-chat

# Dry-run a workflow locally (requires act)
act workflow_dispatch -e <(echo '{"inputs":{"lobehub_tag":"v1.30.0"}}') -W .github/workflows/build-image.yml
```

There are no unit tests in this repository; validation is done at build time via the CI workflows (verifies the patch applied and the credential store file exists).

## Coding Style & Naming Conventions

- **TypeScript**: Follow the existing style in `patches/dogecloud-credential-store.ts` — 2-space indentation, semicolons, `const` over `let` where possible, explicit JSDoc comments on exported functions.
- **Shell scripts**: Use `#!/usr/bin/env bash`, `set -euo pipefail`, and 2-space indentation.
- **Environment variables**: Use `UPPER_SNAKE_CASE` with a `DOGECLOUD_` prefix for DogeCloud-specific vars, `S3_` for S3-related overrides.
- No formal linter is configured; keep patches minimal and focused.

## Testing Guidelines

This repository does not have an automated test suite. Testing relies on:

1. **Patch applicability check** — `git apply --check` in `apply-patches.sh` validates that the patch applies cleanly.
2. **Build-time verification** — The CI workflows grep for expected content after applying patches (see workflow files).
3. **Manual smoke testing** — Run the patched image locally with DogeCloud credentials configured and verify S3 operations work.

When modifying patches, always verify that they apply cleanly against the target LobeHub tag before committing.

## Commit & Pull Request Guidelines

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add DogeCloud STS credential provider patch + CI workflow
fix: correct patch file paths for git apply
```

- Use `feat:` for new features/patches, `fix:` for bug fixes, `docs:` for documentation.
- Keep commits small and focused on a single change.
- Pull requests should include a description of what changed, why, and any new environment variables introduced.

## CI/CD & Release Process

### 触发流程

1. **自动**: A 每 6 小时检查 LobeHub 新 tag → 自动触发 B → B 触发 C + D
2. **手动**: 直接 `workflow_dispatch` 触发 B（指定 `lobehub_tag`），B 会自动触发 C/D
3. **独立运行**: 也可单独触发 C 或 D（需提供 `lobehub_tag` 和 `artifact_run_id`）

### artifact 传递机制

- B 将打补丁后的源码上传为 artifact（`patched-source-<tag>`，7天保留）
- C 和 D 通过 `artifact_run_id` 和 artifact name 从 B 的 run 下载
- 确保 C/D 在 B 的 artifact 过期前运行（7天窗口）

### 各场景选择

| 目标 | 触发方式 |
|------|----------|
| 自动追踪 LobeHub 新版本 | A 定时运行（无需手动操作） |
| 指定 tag 打补丁并构建全部 | 手动触发 B（输入 lobehub_tag） |
| 只想发布源码到 Releases | 手动触发 C（输入 tag + run_id） |
| 只想构建 Docker 镜像 | 手动触发 D（输入 tag + run_id） |
