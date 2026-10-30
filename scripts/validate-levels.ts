/**
 * Sanity checks for the level layouts: connectivity, door placement and blocked doorways.
 * Run with `npm run validate:levels`.
 */
import { LEVELS } from '../src/data/levels';

const BLOCKING = new Set('gbctksmopulfvrqwxy'.split(''));
let failed = false;

for (const L of LEVELS) {
  const rows = L.map.rows;
  const H = rows.length;
  const W = rows[0].length;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? '#' : rows[y][x]);
  const solid = (c: string) => c === '#';
  const walk = (c: string) => !solid(c) && !BLOCKING.has(c);
  const errs: string[] = [];

  rows.forEach((r, i) => r.length !== W && errs.push(`row ${i} length ${r.length} != ${W}`));

  let start: [number, number] | null = null;
  const counts: Record<string, number> = {};
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = at(x, y);
      counts[c] = (counts[c] ?? 0) + 1;
      if (c === 'P') start = [x, y];
      if (c === 'D' || c === 'L') {
        const hor = solid(at(x - 1, y)) && solid(at(x + 1, y));
        const ver = solid(at(x, y - 1)) && solid(at(x, y + 1));
        if (!hor && !ver) errs.push(`door at ${x},${y} is not set in a wall`);
        const [a, b] = hor ? [at(x, y - 1), at(x, y + 1)] : [at(x - 1, y), at(x + 1, y)];
        if (!walk(a) || !walk(b)) errs.push(`door at ${x},${y} is blocked (${a}/${b})`);
      }
      if (c === 'E') {
        if (!(solid(at(x - 1, y)) || solid(at(x + 1, y)) || solid(at(x, y - 1)) || solid(at(x, y + 1)))) errs.push(`exit ${x},${y} not against a wall`);
      }
    }
  }
  if (!start) errs.push('no player start');
  else {
    const seen = new Set<number>();
    const q = [start];
    seen.add(start[1] * W + start[0]);
    while (q.length) {
      const [x, y] = q.pop()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        const k = ny * W + nx;
        if (seen.has(k) || !walk(at(nx, ny))) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = at(x, y);
        if (walk(c) && !seen.has(y * W + x)) errs.push(`unreachable '${c}' at ${x},${y}`);
        if (BLOCKING.has(c)) {
          // interactive props need a reachable neighbour
          if ('xy'.includes(c) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((y + dy) * W + x + dx))) errs.push(`station ${c} at ${x},${y} unreachable`);
        }
      }
    }
  }
  for (const mk of L.map.marks) {
    const c = at(mk.x, mk.y);
    if (!'WKT'.includes(c)) errs.push(`mark ${mk.kind} at ${mk.x},${mk.y} overwritten by '${c}'`);
  }
  const inf = (counts['z'] ?? 0) + (counts['R'] ?? 0) + (counts['B'] ?? 0) + (counts['C'] ?? 0) + (counts['U'] ?? 0) + (counts['0'] ?? 0);
  console.log(`${L.id.padEnd(5)} ${W}x${H}  infected:${inf}  lights:${(counts['*'] ?? 0) + (counts['!'] ?? 0) + (counts['^'] ?? 0)}  doors:${(counts['D'] ?? 0) + (counts['L'] ?? 0)}  vents:${counts['S'] ?? 0}  ${errs.length ? 'FAIL' : 'ok'}`);
  for (const e of errs) console.log('   - ' + e);
  if (errs.length) failed = true;
  if (process.argv.includes('--print')) console.log(rows.join('\n'));
}
if (failed) process.exit(1);
