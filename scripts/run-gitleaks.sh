#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

version="8.30.1"
repository_root="$(git rev-parse --show-toplevel)"
platform="$(uname -s)"
architecture="$(uname -m)"

case "${platform}:${architecture}" in
  Linux:x86_64)
    artifact="gitleaks_${version}_linux_x64.tar.gz"
    expected_sha256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
    ;;
  Darwin:arm64)
    artifact="gitleaks_${version}_darwin_arm64.tar.gz"
    expected_sha256="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
    ;;
  *)
    printf 'Unsupported Gitleaks verification platform: %s:%s\n' "$platform" "$architecture" >&2
    exit 1
    ;;
esac

scan_directory="$(mktemp -d "${TMPDIR:-/tmp}/imonfhir-gitleaks.XXXXXX")"
archive_path="${scan_directory}/${artifact}"
curl --fail --silent --show-error --location \
  "https://github.com/gitleaks/gitleaks/releases/download/v${version}/${artifact}" \
  --output "$archive_path"

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha256="$(sha256sum "$archive_path" | awk '{print $1}')"
else
  actual_sha256="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
fi
test "$actual_sha256" = "$expected_sha256"

tar -xzf "$archive_path" -C "$scan_directory" gitleaks
"${scan_directory}/gitleaks" git --redact --no-banner --verbose "$repository_root"
