const fs = require('node:fs');

const [version] = process.argv.slice(2);
if (!version) {
  console.error('A package version is required');
  process.exit(1);
}

const manifest = fs.readFileSync('deploy/wasmer.toml', 'utf8');
process.stdout.write(manifest.replace(/^version\s*=.*$/m, `version = "${version}"`));
