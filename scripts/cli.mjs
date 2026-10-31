import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = resolve(project, 'node_modules/@iwsdk/cli');
const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));
const binary = resolve(packageDir, typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.iwsdk);
export function cli(domain, action, input, extra = []) {
  const args = [binary, domain, action];
  if (input !== undefined) args.push('--input-json', JSON.stringify(input));
  args.push(...extra);
  const output = execFileSync(process.execPath, args, { cwd: project, encoding: 'utf8', timeout: 180_000, maxBuffer: 16_000_000 });
  const result = JSON.parse(output);
  if (result.ok === false || result.success === false) throw new Error(JSON.stringify(result));
  return result.data ?? result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [domain, action, inputFile, ...extra] = process.argv.slice(2);
  console.log(JSON.stringify(cli(domain, action, inputFile && inputFile !== '-' ? JSON.parse(readFileSync(inputFile, 'utf8')) : undefined, extra), null, 2));
}
