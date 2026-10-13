import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inflateRawSync } from 'node:zlib';
import { buildDeck, safeJson, validateDeck } from '../skills/xiaoxian-slides/scripts/build.mjs';
import { exportDeck } from '../skills/xiaoxian-slides/scripts/export.mjs';

const execute = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'skills/xiaoxian-slides/scripts/build.mjs');
const EXPORT = path.join(ROOT, 'skills/xiaoxian-slides/scripts/export.mjs');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aWQAAAAASUVORK5CYII=';
const deck = () => ({ title: '测试演示', author: '小苋', slides: [{ layout: 'cover', title: '你好，演示', body: '只讲一个核心观点。', notes: '讲者备注只供自己看。', seconds: 20 }, { layout: 'end', theme: 'lime', title: '开始分享', body: '谢谢。', notes: '结束备注。' }] });
async function temporary(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xiaoxian-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function inputFile(dir, data = deck()) {
  const filename = path.join(dir, '内容.json');
  await writeFile(filename, JSON.stringify(data));
  return filename;
}
function embeddedData(html) {
  return JSON.parse(html.match(/<script type="application\/json" id="deck-data">([\s\S]*?)<\/script>/)[1]);
}

test('rejects unknown layouts, themes, fields and wrong types with page numbers', () => {
  for (const [change, pattern] of [
    [slide => { slide.layout = 'unknown'; }, /第 1 页.*未知版式/],
    [slide => { slide.theme = 'pink'; }, /第 1 页.*未知主题/],
    [slide => { slide.titel = 'typo'; }, /第 1 页.*titel/],
    [slide => { slide.body = ['a']; }, /第 1 页.body.*字符串/],
    [slide => { slide.chapter = ['a']; }, /第 1 页.chapter.*字符串/],
    [slide => { slide.seconds = -1; }, /第 1 页.*seconds/],
    [slide => { slide.title = ' '; }, /第 1 页标题.*不能为空/],
    [slide => { slide.imageAlt = 'A'; }, /第 1 页.*imageAlt/],
    [slide => { slide.items = [{ title: 'A' }]; }, /第 1 页.*不显示 items/],
    [slide => { slide.layout = 'cards'; }, /第 1 页.*需要 items/],
    [slide => { slide.layout = 'statement'; slide.image = 'test.png'; }, /第 1 页.*不显示图片/],
    [slide => { slide.layout = 'split'; slide.image = 'test.png'; slide.items = [{ title: 'A' }]; }, /第 1 页.*二选一/],
    [slide => { slide.image = ''; }, /第 1 页.*image 不能为空/]
  ]) {
    const data = deck(); change(data.slides[0]);
    assert.throws(() => validateDeck(data), pattern);
  }
  assert.throws(() => validateDeck({ ...deck(), unknown: true }), /不支持字段/);
  assert.throws(() => validateDeck({ ...deck(), slides: [] }), /1–100/);
  assert.throws(() => validateDeck({ ...deck(), slides: [null] }), /第 1 页.*对象/);
});

test('limits items and warns on long content without truncating it', () => {
  const data = deck();
  data.slides[0] = { layout: 'cards', title: '卡片', items: Array.from({ length: 5 }, (_, i) => ({ title: String(i) })) };
  assert.throws(() => validateDeck(data), /第 1 页.*最多 4 项/);
  data.slides[0].layout = 'steps';
  assert.deepEqual(validateDeck(data), []);
  data.slides[0].items[0].unexpected = 'x';
  assert.throws(() => validateDeck(data), /第 1 页第 1 项.*unexpected/);
  delete data.slides[0].items[0].unexpected;
  data.slides[0].body = '长'.repeat(451);
  assert.match(validateDeck(data)[0], /完整保留/);
  assert.equal(data.slides[0].body.length, 451);
});

test('JSON script escaping prevents HTML and JavaScript breakout', async t => {
  const dir = await temporary(t);
  const payload = '</script><script>globalThis.hacked=true</script>\u2028\u2029';
  const data = deck(); data.title = '<b>标题 & "文本"</b>'; data.slides[0].title = payload;
  const result = await buildDeck(await inputFile(dir, data));
  const html = await readFile(result.outputPath, 'utf8');
  assert.ok(html.includes('<title>&lt;b&gt;标题 &amp; &quot;文本&quot;&lt;/b&gt;</title>'));
  assert.ok(!html.includes(payload));
  assert.equal(embeddedData(html).slides[0].title, payload);
  assert.ok(safeJson(payload).includes('\\u003c/script>'));
  assert.ok(safeJson(payload).includes('\\u2028\\u2029'));
});

test('build embeds local images relative to JSON and contains no private image path', async t => {
  const dir = await temporary(t);
  const data = deck(); data.slides[0].image = '照片.png'; data.slides[0].imageAlt = '示例照片';
  await writeFile(path.join(dir, '照片.png'), Buffer.from(PNG, 'base64'));
  const input = await inputFile(dir, data);
  const output = path.join(dir, 'portable', '演示.html');
  await execute(process.execPath, [BUILD, input, '-o', output], { cwd: tmpdir() });
  const html = await readFile(output, 'utf8');
  assert.equal(embeddedData(html).slides[0].image, `data:image/png;base64,${PNG}`);
  assert.ok(!html.includes(dir));
  assert.ok(!/__XI_(?:TITLE|CSS|DATA|JS)__/.test(html));
  assert.ok(!/<(?:script|link)[^>]+(?:src|href)=["'](?:https?:|\/\/)/i.test(html));
  assert.equal(html.match(/id="deck-data"/g).length, 1);
});

test('accepts image data URI, rejects remote/SVG/missing/spoofed images', async t => {
  const dir = await temporary(t);
  let data = deck(); data.slides[0].image = `data:image/png;base64,${PNG}`;
  assert.equal((await buildDeck(await inputFile(dir, data))).slides, 2);
  for (const [image, pattern] of [
    ['https://example.com/photo.jpg', /第 1 页图片.*远程/],
    ['file:///private/photo.jpg', /第 1 页图片.*file:/],
    ['data:image/svg+xml;base64,PHN2Zz4=', /第 1 页图片.*SVG/],
    ['vector.svg', /第 1 页图片.*SVG/],
    ['missing.png', /第 1 页图片.*ENOENT/],
    ['data:image/png;base64,PHN2Zz4=', /第 1 页图片.*格式不符/]
  ]) {
    data = deck(); data.slides[0].image = image;
    await assert.rejects(buildDeck(await inputFile(dir, data)), pattern);
  }
});

test('missing files, invalid JSON and CLI misuse fail clearly without generating HTML', async t => {
  const dir = await temporary(t);
  await assert.rejects(buildDeck(path.join(dir, 'missing.json')), /无法读取输入文件.*ENOENT/);
  const input = path.join(dir, 'invalid.json'); await writeFile(input, '{ bad');
  await assert.rejects(buildDeck(input), /JSON 格式错误/);
  await assert.rejects(execute(process.execPath, [BUILD, '--unknown']), error => { assert.match(error.stderr, /未知参数/); return error.code === 1; });
  await assert.rejects(execute(process.execPath, [EXPORT, 'a.html', '--format']), error => { assert.match(error.stderr, /后需要一个值/); return error.code === 1; });
  await assert.rejects(exportDeck(path.join(dir, 'missing.html')), /找不到输入 HTML/);
  assert.ok(!(await readdir(dir)).some(name => name.endsWith('.html')));
  assert.match((await execute(process.execPath, [BUILD, '--help'])).stdout, /零|本地|图片/);
});

// Read only the ZIP entries needed to validate slide count and notes, without a test dependency.
function zipEntries(buffer) {
  const entries = new Map();
  for (let offset = 0; offset <= buffer.length - 46; offset++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const method = buffer.readUInt16LE(offset + 10);
    const length = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const bytes = buffer.subarray(start, start + length);
    entries.set(name, method === 8 ? inflateRawSync(bytes) : bytes);
    offset += 45 + nameLength + extraLength + commentLength;
  }
  return entries;
}

let exportAvailable = false;
try {
  const { chromium } = await import('playwright');
  await import('pptxgenjs');
  await readFile(chromium.executablePath());
  exportAvailable = true;
} catch { /* Zero-dependency build tests remain runnable before optional install. */ }

test('export creates 16:9 PDF and image PPTX with every page and speaker notes', { skip: !exportAvailable ? '可选导出验证：npm install && npx playwright install chromium' : false, timeout: 60000 }, async t => {
  const dir = await temporary(t);
  const data = deck(); data.slides[0].image = `data:image/png;base64,${PNG}`;
  const { outputPath } = await buildDeck(await inputFile(dir, data));
  const outDir = path.join(dir, 'exports');
  const result = await exportDeck(outputPath, { outDir });
  assert.equal(result.slides, 2);
  assert.deepEqual(result.files.map(file => file.type), ['pdf', 'pptx']);
  const pdf = await readFile(result.files[0].path);
  const pdfSource = pdf.toString('latin1');
  assert.ok(pdfSource.startsWith('%PDF-'));
  assert.equal((pdfSource.match(/\/Type\s*\/Page\b/g) ?? []).length, 2);
  const mediaBox = pdfSource.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(mediaBox, 'PDF has a page size');
  // Chromium rounds CSS pixels slightly when converting them to PDF points.
  assert.ok(Math.abs(Number(mediaBox[1]) / Number(mediaBox[2]) - 16 / 9) < 0.001, 'PDF has 16:9 pages');
  const entries = zipEntries(await readFile(result.files[1].path));
  assert.equal([...entries.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 2);
  assert.equal([...entries.keys()].filter(name => /^ppt\/media\/image-.*\.png$/.test(name)).length, 2);
  assert.ok([...entries.entries()].some(([name, bytes]) => /^ppt\/notesSlides\/notesSlide/.test(name) && bytes.toString('utf8').includes(data.slides[0].notes)));
  assert.deepEqual((await readdir(outDir)).sort(), ['内容.pdf', '内容.pptx']);
});
