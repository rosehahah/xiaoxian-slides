#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(HERE, '../assets');
const LAYOUTS = new Set(['cover', 'statement', 'split', 'cards', 'steps', 'timeline', 'quote', 'end']);
const THEMES = new Set(['paper', 'blue', 'ink', 'lime', 'coral']);
const DECK_KEYS = new Set(['title', 'author', 'subtitle', 'slides']);
const SLIDE_KEYS = new Set(['layout', 'title', 'body', 'kicker', 'theme', 'items', 'image', 'imageAlt', 'notes', 'seconds']);
const ITEM_KEYS = new Set(['title', 'body']);
const MIMES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function fail(where, message) { throw new Error(`${where}：${message}`); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function object(value, where, keys) {
  if (!isObject(value)) fail(where, '必须是对象。');
  for (const key of Object.keys(value)) if (!keys.has(key)) fail(where, `不支持字段 “${key}”，请检查拼写。`);
}
function string(value, where, { optional = false, nonempty = false } = {}) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string') fail(where, '必须是字符串。');
  if (nonempty && !value.trim()) fail(where, '不能为空。');
}

/** Validate without mutating or silently dropping content. Returns editorial warnings. */
export function validateDeck(deck) {
  const warnings = [];
  object(deck, '演示', DECK_KEYS);
  string(deck.title, '演示标题', { nonempty: true });
  string(deck.author, '作者', { optional: true });
  string(deck.subtitle, '演示副标题', { optional: true });
  if (!Array.isArray(deck.slides) || deck.slides.length < 1 || deck.slides.length > 100) fail('演示', 'slides 必须是包含 1–100 页的数组。');
  deck.slides.forEach((slide, index) => {
    const where = `第 ${index + 1} 页`;
    object(slide, where, SLIDE_KEYS);
    if (!LAYOUTS.has(slide.layout)) fail(where, `未知版式 “${String(slide.layout)}”；可用 ${[...LAYOUTS].join(', ')}。`);
    string(slide.title, `${where}标题`, { nonempty: true });
    for (const key of ['body', 'kicker', 'image', 'imageAlt', 'notes']) string(slide[key], `${where}.${key}`, { optional: true });
    if (slide.image !== undefined && !slide.image.trim()) fail(where, 'image 不能为空。');
    if (slide.imageAlt !== undefined && !slide.image) fail(where, 'imageAlt 需要同时提供 image。');
    if (slide.image && !['cover', 'split'].includes(slide.layout)) fail(where, `${slide.layout} 版式不显示图片，请使用 cover 或 split。`);
    if (slide.layout === 'split' && slide.image && slide.items !== undefined) fail(where, 'split 的 image 与 items 二选一，不能同时提供。');
    if (slide.theme !== undefined && !THEMES.has(slide.theme)) fail(where, `未知主题 “${String(slide.theme)}”；可用 ${[...THEMES].join(', ')}。`);
    if (slide.seconds !== undefined && (!Number.isFinite(slide.seconds) || slide.seconds <= 0 || slide.seconds > 3600)) fail(where, 'seconds 必须是大于 0、不超过 3600 的数字。');
    if (slide.items !== undefined) {
      if (!Array.isArray(slide.items) || slide.items.length === 0) fail(where, 'items 必须是非空数组。');
      const limit = ['steps', 'timeline'].includes(slide.layout) ? 5 : slide.layout === 'split' ? 2 : 4;
      if (!['cards', 'split', 'steps', 'timeline'].includes(slide.layout)) fail(where, `${slide.layout} 版式不显示 items，请改用 cards / split / steps / timeline。`);
      if (slide.items.length > limit) fail(where, `${slide.layout} 最多 ${limit} 项，请拆成多页。`);
      if (['cards', 'steps', 'timeline'].includes(slide.layout) && slide.items.length < 2) fail(where, `${slide.layout} 至少需要 2 项；单个观点可用 statement。`);
      slide.items.forEach((item, itemIndex) => {
        const itemWhere = `${where}第 ${itemIndex + 1} 项`;
        object(item, itemWhere, ITEM_KEYS);
        string(item.title, `${itemWhere}标题`, { nonempty: true });
        string(item.body, `${itemWhere}正文`, { optional: true });
        if (item.title.length > 16 || (item.body?.length ?? 0) > 50) warnings.push(`${itemWhere}较长，建议预览并拆页；内容已完整保留。`);
      });
    }
    if (['cards', 'steps', 'timeline'].includes(slide.layout) && !slide.items) fail(where, `${slide.layout} 需要 items 数组（至少 2 项）。`);
    if (slide.title.length > 36 || (slide.body?.length ?? 0) > 80) warnings.push(`${where}文字较长，建议预览并拆页；内容已完整保留。`);
  });
  return warnings;
}

export function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
export function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function imageHasSignature(buffer, mime) {
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
  if (mime === 'image/webp') return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}
async function embedImage(source, baseDir, where) {
  let buffer;
  let mime;
  if (/^data:/i.test(source)) {
    const match = source.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) fail(where, '只支持 PNG、JPEG、WebP、GIF 的 base64 data URI；SVG 请先转成 PNG。');
    mime = match[1];
    buffer = Buffer.from(match[2], 'base64');
    if (buffer.toString('base64') !== match[2]) fail(where, '图片 base64 编码无效。');
  } else {
    if ((!path.isAbsolute(source) && /^[a-z][a-z\d+.-]*:/i.test(source)) || source.startsWith('//')) fail(where, '不支持远程 URL 或 file: URL；请先下载图片，填写相对 JSON 文件的本地路径。');
    const filename = path.resolve(baseDir, source);
    mime = MIMES[path.extname(filename).toLowerCase()];
    if (!mime) fail(where, '只支持 PNG、JPG、JPEG、WebP、GIF 图片；SVG 请先转成 PNG。');
    try { buffer = await readFile(filename); }
    catch (error) { fail(where, `无法读取图片 “${path.basename(source)}” (${error.code ?? '读取失败'})。`); }
  }
  if (buffer.length > MAX_IMAGE_BYTES) fail(where, '图片超过 15 MB，请压缩后重试。');
  if (!imageHasSignature(buffer, mime)) fail(where, '图片内容与声明格式不符，或图片文件损坏。');
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** Build an offline, single-file HTML deck. Paths resolve relative to input, never cwd. */
export async function buildDeck(input, output) {
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output ?? inputPath.replace(/\.json$/i, '') + '.html');
  if (inputPath === outputPath) throw new Error('输入 JSON 和输出 HTML 不能是同一个文件。');
  let raw;
  try { raw = await readFile(inputPath, 'utf8'); }
  catch (error) { throw new Error(`无法读取输入文件 (${error.code ?? '读取失败'})：${inputPath}`); }
  let deck;
  try { deck = JSON.parse(raw); }
  catch (error) { throw new Error(`JSON 格式错误：${error.message}`); }
  const warnings = validateDeck(deck);
  const embedded = structuredClone(deck);
  for (let index = 0; index < embedded.slides.length; index++) {
    if (embedded.slides[index].image) embedded.slides[index].image = await embedImage(embedded.slides[index].image, path.dirname(inputPath), `第 ${index + 1} 页图片`);
  }
  const [template, css, js] = await Promise.all(['template.html', 'deck.css', 'deck.js'].map(name => readFile(path.join(ASSETS, name), 'utf8')));
  const values = { '__XI_TITLE__': escapeHtml(deck.title), '__XI_CSS__': css, '__XI_DATA__': safeJson(embedded), '__XI_JS__': js };
  for (const token of Object.keys(values)) if (!template.includes(token)) throw new Error(`HTML 模板缺少占位符 ${token}。`);
  const html = template.replace(/__XI_(?:TITLE|CSS|DATA|JS)__/g, token => values[token]);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, 'utf8');
  return { outputPath, slides: deck.slides.length, warnings };
}

const HELP = `小苋演示 · 构建离线 HTML\n\n用法：\n  node skills/xiaoxian-slides/scripts/build.mjs <内容.json> [-o <演示.html>]\n\n默认输出：输入文件旁的同名 .html。可从任意目录运行。\n图片：相对于 JSON 的本地 PNG/JPG/WebP/GIF，或 base64 data URI。\n图片会内嵌到 HTML；不支持远程图片和 SVG。\n\n示例：\n  node skills/xiaoxian-slides/scripts/build.mjs examples/demo.json -o examples/demo.html\n`;
export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  let input;
  let output;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-o' || arg === '--output') {
      if (!args[index + 1] || args[index + 1].startsWith('-')) throw new Error(`${arg} 后需要输出文件路径。`);
      if (output) throw new Error('输出路径只能指定一次。');
      output = args[++index];
    } else if (arg.startsWith('-')) throw new Error(`未知参数 ${arg}；使用 --help 查看用法。`);
    else if (input) throw new Error('每次只构建一个 JSON 文件。');
    else input = arg;
  }
  if (!input) throw new Error('缺少内容 JSON 文件；使用 --help 查看用法。');
  const result = await buildDeck(input, output);
  for (const warning of result.warnings) console.warn(`提醒：${warning}`);
  console.log(`已生成 ${result.slides} 页：${result.outputPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`构建失败：${error.message}`); process.exitCode = 1; });
}
