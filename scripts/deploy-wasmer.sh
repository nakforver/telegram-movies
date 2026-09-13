#!/usr/bin/env bash
set -euo pipefail

package_version="${1:-4.0.$(date +%s)}"
namespace="wechatfree011"
package_name="telegram-movies"
generated_manifest="deploy/.deploy-generated.wasmer.toml"
generated_app="$(mktemp /tmp/telegram-movies-app.XXXXXX.yaml)"

npm ci
npm test
npm run build

node "$PWD/scripts/generate-deploy-manifest.cjs" "$package_version" > "$generated_manifest"

cat > "$generated_app" <<EOF
kind: wasmer.io/App.v0
name: telegram-movies
owner: wechatfree011
package: ${namespace}/${package_name}@=${package_version}
app_id: da_n73IatAUWBgG
EOF

package_dir="$(mktemp -d)"
package_file="$package_dir/telegram-movies.webc"
wasmer package build "$generated_manifest" -o "$package_file"
wasmer publish "$package_file" --namespace "$namespace" --name "$package_name" --version "$package_version" --non-interactive --wait=all
(
  cd /tmp
  wasmer deploy --path "$generated_app" --non-interactive --owner "$namespace"
)

printf '%s\n' "Deployed version ${package_version}"
rm -rf "$package_dir"
rm "$generated_manifest"
rm "$generated_app"
