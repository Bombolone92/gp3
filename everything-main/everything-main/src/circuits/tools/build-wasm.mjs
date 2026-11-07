// Builds wasm/kernel (Rust) into src/kernel/kernel.wasm. The built file is
// committed, so the app builds without a Rust toolchain; run this after
// editing the crate. The crate pins its toolchain in rust-toolchain.toml.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const crate = path.join(root, 'wasm/kernel');
execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '--target-dir', '../target'], {
  cwd: crate,
  stdio: 'inherit',
});
const out = path.join(root, 'wasm/target/wasm32-unknown-unknown/release/kernel.wasm');
fs.mkdirSync(path.join(root, 'src/kernel'), { recursive: true });
fs.copyFileSync(out, path.join(root, 'src/kernel/kernel.wasm'));
console.log(`kernel.wasm: ${fs.statSync(out).size} bytes`);
