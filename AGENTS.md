# Repository Guidelines

## Project Structure & Module Organization

```
├── patches/
│   ├── s3-credential-hook.patch          # Patch to add setCredentialProvider hook in LobeHub S3 module
│   └── dogecloud-credential-store.ts     # DogeCloud STS credential provider (copied into LobeHub at build)
├── scripts/
│   └── apply-patches.sh                  # One-click script to apply patches to a LobeHub checkout
├── .github/workflows/
│   ├── apply-patches.yml                 # Clone LobeHub + apply patches + upload artifact
│   ├── build-image.yml                   # Clone + patch + build Docker image + push to GHCR
│   └── release-source.yml                # Clone + patch + archive tar.gz + publish to Releases
├── README.md                             # Full documentation
└── AGENTS.md                             # This file
```

- **`patches/`** — Patch files and supplementary source that get applied/copied into LobeHub at build time.
- **`scripts/`** — Automation scripts for applying patches locally.
- **`.github/workflows/`** — GitHub Actions CI/CD workflows.

## GitHub Actions Workflows

### `apply-patches.yml` — Apply Patches
- **Trigger**: `workflow_dispatch` (manual, optional `lobehub_tag` input)
- **What it does**: Resolves LobeHub tag → clones LobeHub → applies patches → uploads patched source as a build artifact (7-day retention)
- **Use case**: For downstream tasks that need the patched source without building a Docker image

### `build-image.yml` — Build Docker Image
- **Trigger**: `release` published, or `workflow_dispatch` (manual, optional `lobehub_tag` input)
- **What it does**: Resolves LobeHub tag → clones LobeHub → applies patches → builds Docker image → pushes to `ghcr.io/inkOrCloud/lobehub-dogecloud-patch`
- **Tags pushed**: `latest`, `<semver>`, `<major>.<minor>`
- **Secrets**: `GHCR_PAT` (optional, falls back to `GITHUB_TOKEN`)
- **This replaces the original monolithic `build-on-release.yml`**

### `release-source.yml` — Release Patched Source
- **Trigger**: `release` published, or `workflow_dispatch` (manual, optional `lobehub_tag` input)
- **What it does**: Resolves LobeHub tag → clones LobeHub → applies patches → creates `tar.gz` archive → uploads to GitHub Releases
- **Release naming** (manual trigger): `patched-<lobehub_tag>` (e.g. `patched-v2.2.3`)
- **Use case**: Distributing the patched source code for users who want to inspect or build manually

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

Releases are triggered by publishing a GitHub Release, or manually via `workflow_dispatch` with a specific LobeHub tag. The three CI workflows handle different aspects:

1. **`apply-patches.yml`** — Just patches the source and makes it available as an artifact.
2. **`build-image.yml`** — Patches and builds a Docker image, pushing to GHCR. This is the primary release workflow.
3. **`release-source.yml`** — Patches and publishes the source as a `tar.gz` archive to GitHub Releases.

Tagged releases use semver (`v1.2.3`); `latest` is always pushed on each build.

### Which workflow to run?

| Goal | Workflow |
|------|----------|
| Just want the patched source artifact | `apply-patches.yml` |
| Need a Docker image | `build-image.yml` |
| Want to distribute the source via Releases | `release-source.yml` |
