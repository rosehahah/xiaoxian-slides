#!/usr/bin/env node
import { access, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL_HINT = `\n仓库用户：在仓库根目录运行 npm install，再运行 npx playwright install chromium。\n独立 Skill 用户：\n  npm install --prefix "${SKILL_DIR}" --no-save playwright@1.62.1 pptxgenjs@4.0.1\n  cd "${SKILL_DIR}"\n  npx playwright install chromium`;

async function dependencies(needsPptx) {
  let playwright;
  let PptxGenJS;
  try { playwright = await import('playwright'); }
  catch { throw new Error(`缺少可选导出依赖 playwright。${INSTALL_HINT}`); }
  if (needsPptx) {
    try { const module = await import('pptxgenjs'); PptxGenJS = module.default; }
    catch { throw new Error(`缺少可选导出依赖 pptxgenjs。${INSTALL_HINT}`); }
  }
  return { chromium: playwright.chromium, PptxGenJS };
}

/** Export our generated HTML to a 16:9 PDF and/or image-based PowerPoint deck. */
export async function exportDeck(input, { outDir = 'output', format = 'both' } = {}) {
  if (!['pdf', 'pptx', 'both'].includes(format)) throw new Error('format 必须是 pdf、pptx 或 both。');
  const inputPath = path.resolve(input);
  if (!/\.html?$/i.test(inputPath)) throw new Error('请输入由小苋演示生成的 .html 文件。');
  try { await access(inputPath); }
  catch { throw new Error(`找不到输入 HTML：${inputPath}`); }
  const needsPdf = format !== 'pptx';
  const needsPptx = format !== 'pdf';
  const { chromium, PptxGenJS } = await dependencies(needsPptx);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) {
    if (error.message.includes("Executable doesn't exist")) throw new Error('尚未安装导出用 Chromium。请运行 npx playwright install chromium。');
    throw new Error(`无法启动导出用 Chromium，请确认当前环境允许启动浏览器。\n${error.message.split('\n')[0]}`);
  }
  let temporary;
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const runtimeErrors = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    // Self-contained decks should never need a server, CDN, or third-party request.
    await page.route('**/*', route => /^(file:|data:|about:)/.test(route.request().url()) ? route.continue() : route.abort());
    await page.goto(pathToFileURL(inputPath).href, { waitUntil: 'load', timeout: 30000 });
    try { await page.waitForFunction(() => window.xiaoxian?.ready === true, null, { timeout: 15000 }); }
    catch { throw new Error(`页面没有就绪的小苋演示播放器。请先重新构建 HTML。${runtimeErrors.length ? `\n${runtimeErrors.join('\n')}` : ''}`); }
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.complete ? Promise.resolve() : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; })));
    });
    const invalidImages = await page.evaluate(() => [...document.images].filter(image => !image.complete || image.naturalWidth === 0).length);
    if (invalidImages) throw new Error(`演示里有 ${invalidImages} 张图片无法显示，请检查并重新构建。`);
    if (runtimeErrors.length) throw new Error(`播放器运行出错：\n${runtimeErrors.join('\n')}`);
    await page.evaluate(() => { document.body.dataset.export = 'true'; });
    const metadata = await page.evaluate(() => ({
      title: document.title,
      slides: window.xiaoxian.slides,
      count: document.querySelectorAll('#stage > .slide').length
    }));
    if (!Array.isArray(metadata.slides) || !metadata.slides.length || metadata.count !== metadata.slides.length) throw new Error('播放器页数不匹配，请重新构建 HTML。');

    const destination = path.resolve(outDir);
    await mkdir(destination, { recursive: true });
    temporary = await mkdtemp(path.join(destination, '.xiaoxian-export-'));
    const basename = path.basename(inputPath).replace(/\.html?$/i, '');
    const pending = [];
    if (needsPdf) {
      const pdfPath = path.join(temporary, `${basename}.pdf`);
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: pdfPath, width: '1600px', height: '900px', printBackground: true, preferCSSPageSize: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
      pending.push({ type: 'pdf', source: pdfPath, path: path.join(destination, `${basename}.pdf`) });
      await page.emulateMedia({ media: 'screen' });
    }
    if (needsPptx) {
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      pptx.author = '小苋演示';
      pptx.subject = '由小苋演示导出的图片版 PPTX；文字与布局保留为整页图片。';
      pptx.title = metadata.title;
      pptx.company = 'Xiaoxian Slides';
      pptx.lang = 'zh-CN';
      await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important}#toolbar,.modal,.toast,#presenter{display:none!important}#viewport{inset:0!important}#stage{position:relative!important;left:auto!important;top:auto!important;transform:none!important;flex:none!important}` });
      for (let index = 0; index < metadata.slides.length; index++) {
        await page.evaluate(index => window.xiaoxian.go(index), index);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const screenshot = await page.locator('#stage').screenshot({ type: 'png', animations: 'disabled' });
        const slide = pptx.addSlide();
        slide.addImage({ data: `image/png;base64,${screenshot.toString('base64')}`, x: 0, y: 0, w: 13.333333, h: 7.5 });
        if (metadata.slides[index].notes) slide.addNotes(metadata.slides[index].notes);
      }
      const pptxPath = path.join(temporary, `${basename}.pptx`);
      await pptx.writeFile({ fileName: pptxPath, compression: true });
      pending.push({ type: 'pptx', source: pptxPath, path: path.join(destination, `${basename}.pptx`) });
    }
    for (const item of pending) if ((await stat(item.source)).size < 100) throw new Error(`${item.type.toUpperCase()} 输出异常，未写入最终文件。`);
    for (const item of pending) await rename(item.source, item.path);
    return { slides: metadata.slides.length, files: pending.map(({ type, path }) => ({ type, path })) };
  } finally {
    try { await browser.close(); }
    finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
  }
}

const HELP = `小苋演示 · 可选导出\n\n用法：\n  node skills/xiaoxian-slides/scripts/export.mjs <演示.html> [--out-dir output] [--format pdf|pptx|both]\n\n默认同时生成 PDF 与图片版 PPTX，保留讲者备注。\nPPTX 的文字是图片，不可直接编辑；HTML 动画和快捷键不进入导出文件。\n输出目录的同名文件会被覆盖。仅导出自己信任、由本项目生成的 HTML。\n\n首次准备：\n  npm install\n  npx playwright install chromium\n\n示例：\n  node skills/xiaoxian-slides/scripts/export.mjs examples/demo.html --out-dir output\n`;
export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  let input;
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--out-dir' || arg === '--format') {
      if (!args[index + 1] || args[index + 1].startsWith('-')) throw new Error(`${arg} 后需要一个值。`);
      const key = arg === '--out-dir' ? 'outDir' : 'format';
      if (options[key]) throw new Error(`${arg} 只能指定一次。`);
      options[key] = args[++index];
    } else if (arg.startsWith('-')) throw new Error(`未知参数 ${arg}；使用 --help 查看用法。`);
    else if (input) throw new Error('每次只导出一个 HTML 文件。');
    else input = arg;
  }
  if (!input) throw new Error('缺少演示 HTML 文件；使用 --help 查看用法。');
  const result = await exportDeck(input, options);
  console.log(`已导出 ${result.slides} 页：`);
  for (const file of result.files) console.log(`${file.type.toUpperCase()}：${file.path}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`导出失败：${error.message}`); process.exitCode = 1; });
}
