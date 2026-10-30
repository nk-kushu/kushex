#!/bin/sh
set -eu

repo_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
kushibot_directory=$(CDPATH= cd -- "$repo_directory/../kushibot" && pwd)
docker build -f "$repo_directory/docker/Dockerfile.cli-tests" -t kushex-cli-sandbox-tests "$repo_directory"
docker run --rm \
  --security-opt "seccomp=$repo_directory/docker/cli-seccomp.json" \
  --mount "type=bind,source=$repo_directory,target=/source/kushex,readonly" \
  --mount "type=bind,source=$kushibot_directory,target=/source/kushibot,readonly" \
  kushex-cli-sandbox-tests
docker run --rm \
  --mount "type=bind,source=$repo_directory,target=/source/kushex,readonly" \
  --mount "type=bind,source=$kushibot_directory,target=/source/kushibot,readonly" \
  kushex-cli-sandbox-tests \
  node --import /usr/local/lib/node_modules/tsx/dist/loader.mjs \
  --test plugins/coding/tests/SandboxUnavailable.test.ts
