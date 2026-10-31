import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { cli } from './cli.mjs';
import { runAcceptance } from './xr-engine.mjs';

const files = readdirSync('tests/xr').filter(f=>f.endsWith('.json')).sort();
const scenarios = files.map(f=>JSON.parse(readFileSync(`tests/xr/${f}`,'utf8')));
if (process.argv.includes('--export')) {
  console.log(JSON.stringify({engine:runAcceptance.toString(),scenarios}));
} else {
  mkdirSync('output/xr',{recursive:true});
  const lines=[];
  try {
    await runAcceptance(async (...args) => { const r=cli(...args); return r.result??r; }, scenarios, line=>{lines.push(line);console.log(line)});
  } catch (error) { process.exitCode=1; console.error(error.message); }
  writeFileSync('output/xr/acceptance.txt',lines.join('\n')+'\n');
}
