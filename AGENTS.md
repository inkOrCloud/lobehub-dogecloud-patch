# Repository Guidelines

## Project Structure & Module Organization

```
├── patches/
│   ├── s3-credential-hook.patch          # Patch to add setCredentialProvider hook in LobeHub S3 module
│   └── dogecloud-credential-store.ts     # DogeCloud STS credential provider (copied into LobeHub at build)
├── scripts/
│   └── apply-patches.sh                  # One-click script to apply patches to a LobeHub checkout
├── .github/workflows/
│   └── build-on-release.yml              # CI: build patched Docker image and push to GHCR
├── README.md                             # Full documentation
└── AGENTS.md                             # This file
```

- **`patches/`** — Patch files and supplementary source that get applied/copied into LobeHub at build time.
- **`scripts/`** — Automation scripts for applying patches locally.
- **`.github/workflows/`** — GitHub Actions CI/CD workflows.

## Build, Test, and Development Commands

```bash
# Apply patches to a local LobeHub clone
bash scripts/apply-patches.sh /path/to/lobe-chat

# Dry-run the GitHub Actions workflow locally (requires act)
act workflow_dispatch -e <(echo '{"inputs":{"lobehub_tag":"v1.30.0"}}')
```

There are no unit tests in this repository; validation is done at build time via the CI workflow (verifies the patch applied and the credential store file exists).

## Coding Style & Naming Conventions

- **TypeScript**: Follow the existing style in `patches/dogecloud-credential-store.ts` — 2-space indentation, semicolons, `const` over `let` where possible, explicit JSDoc comments on exported functions.
- **Shell scripts**: Use `#!/usr/bin/env bash`, `set -euo pipefail`, and 2-space indentation.
- **Environment variables**: Use `UPPER_SNAKE_CASE` with a `DOGECLOUD_` prefix for DogeCloud-specific vars, `S3_` for S3-related overrides.
- No formal linter is configured; keep patches minimal and focused.

## Testing Guidelines

This repository does not have an automated test suite. Testing relies on:

1. **Patch applicability check** — `git apply --check` in `apply-patches.sh` validates that the patch applies cleanly.
2. **Build-time verification** — The CI workflow greps for expected content after applying patches (see `build-on-release.yml`).
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

Releases are triggered by publishing a GitHub Release, or manually via `workflow_dispatch` with a specific LobeHub tag. The CI workflow:

1. Resolves the LobeHub tag (latest release or manually specified).
2. Clones LobeHub at that tag.
3. Applies patches via `scripts/apply-patches.sh`.
4. Builds and pushes a Docker image to `ghcr.io/inkOrCloud/lobehub-dogecloud-patch`.

Tagged releases use semver (`v1.2.3`); `latest` is always pushed on each release.
