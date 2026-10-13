#!/usr/bin/env node
// Package only committed project files; local outputs and personal files stay out.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('package.json 版本号无效。');
mkdirSync(out, { recursive: true });
execFileSync('git', ['archive', '--format=zip', '--prefix=xiaoxian-slides/', '-o', path.join(out, `xiaoxian-slides-v${version}.zip`), 'HEAD'], { cwd: root });
execFileSync('git', ['archive', '--format=zip', '--prefix=xiaoxian-slides/', '-o', path.join(out, `xiaoxian-slides-skill-v${version}.zip`), 'HEAD:skills/xiaoxian-slides'], { cwd: root });
console.log(`已打包到 ${out}`);
