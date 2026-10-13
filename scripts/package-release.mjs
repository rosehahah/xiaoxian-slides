#!/usr/bin/env node
// Package only committed project files; local outputs and personal files stay out.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist');
mkdirSync(out, { recursive: true });
execFileSync('git', ['archive', '--format=zip', '--prefix=xiaoxian-slides/', '-o', path.join(out, 'xiaoxian-slides-v0.1.0.zip'), 'HEAD'], { cwd: root });
execFileSync('git', ['archive', '--format=zip', '--prefix=xiaoxian-slides/', '-o', path.join(out, 'xiaoxian-slides-skill-v0.1.0.zip'), 'HEAD:skills/xiaoxian-slides'], { cwd: root });
console.log(`已打包到 ${out}`);
