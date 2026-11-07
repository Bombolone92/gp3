import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.each([
  ['scatter value axis', 'scatter', [1e16, 1e16 + 2], [1, 2], {}],
  ['scatter horizontal axis', 'scatter', [1, 2], [1e16, 1e16 + 2], {}],
  ['fixed value axis', 'column', [1e16, 1e16 + 2], null, { yMin: 1e16, yMax: 1e16 + 2 }],
])('renders a narrow %s at large magnitudes without an unbounded tick loop', (_label, type, values, x, bounds) => {
  // Isolate rendering so a regression cannot hang the test runner itself.
  const data = { categories: ['A', 'B'], series: [{ name: 'Values', values }], x };
  const chart = { type, legend: false, ...bounds };
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { renderChartSvg } from './src/ui/chartsvg.js';
    process.stdout.write(renderChartSvg(${JSON.stringify(data)}, ${JSON.stringify(chart)}, 480, 300));
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), timeout: 2000, encoding: 'utf8' });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('</svg>');
  expect(result.stdout).not.toMatch(/NaN|Infinity/);
  expect(result.stdout.length).toBeLessThan(20000);
  if (type === 'scatter') expect(result.stdout.match(/<circle /g)).toHaveLength(2);
});
