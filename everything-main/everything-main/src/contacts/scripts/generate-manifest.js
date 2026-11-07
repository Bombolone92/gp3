#!/usr/bin/env node
/**
 * Write public/.well-known/mcp.json from the tool definitions in src/api/.
 *
 * The manifest is what a client reads to learn what Contacts offers *without*
 * launching it — so it has to be a static file, and a static file copied by
 * hand is a static file that goes stale. Regenerate with:
 *
 *   npm run manifest
 *
 * A test (src/api/mcp.test.js) fails if the checked-in file drifts from
 * buildManifest(), and `npm run build` runs the tests, so a stale manifest
 * cannot ship.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildManifest } from '../src/api/mcp.js'

const OUT = fileURLToPath(new URL('../public/.well-known/mcp.json', import.meta.url))

writeFileSync(OUT, JSON.stringify(buildManifest(), null, 2) + '\n')
console.log(`Wrote ${OUT}`)
