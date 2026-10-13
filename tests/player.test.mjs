import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const demo = path.join(root, 'examples/demo.html');

test('离线播放器：导航、焦点、讲者同步、缩放和打印', async t => {
  execFileSync(process.execPath, ['skills/xiaoxian-slides/scripts/build.mjs', 'examples/demo.json', '-o', 'examples/demo.html'], { cwd: root });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(pathToFileURL(demo).href);
    await page.waitForFunction(() => window.xiaoxian?.ready);
    const count = await page.evaluate(() => window.xiaoxian.slides.length);
    assert.ok(count >= 8, '示例应展示全部版式');

    await t.test('离线页面无外部资源，全部版式均可播放', async () => {
      assert.deepEqual(await page.evaluate(() => performance.getEntriesByType('resource').filter(x => /^https?:/.test(x.name)).map(x => x.name)), []);
      const layouts = await page.evaluate(() => [...new Set(window.xiaoxian.slides.map(s => s.layout))]);
      assert.equal(layouts.length, 8);
      for (let i = 0; i < count; i++) {
        await page.evaluate(index => window.xiaoxian.go(index), i);
        assert.equal(await page.locator('.slide.active').count(), 1);
        assert.equal(await page.evaluate(() => window.xiaoxian.current), i);
        const clipped = await page.evaluate(() => {
          const slide = document.querySelector('.slide.active');
          const bounds = slide.getBoundingClientRect();
          const check = [...slide.querySelectorAll('h1,h2,h3,p,.item-number')];
          return check.filter(el => {
            const b = el.getBoundingClientRect();
            const css = getComputedStyle(el);
            const maxHeight = parseFloat(css.maxHeight);
            const clipsText = ['hidden', 'clip'].includes(css.overflowY) && el.scrollHeight > el.clientHeight + 2;
            const exceedsBudget = Number.isFinite(maxHeight) && el.scrollHeight > maxHeight + 20;
            return b.width && b.height && (b.left < bounds.left - 2 || b.right > bounds.right + 2 || b.top < bounds.top - 2 || b.bottom > bounds.bottom + 2 || clipsText || exceedsBudget);
          }).map(el => el.textContent.slice(0, 60));
        });
        assert.deepEqual(clipped, [], `第 ${i + 1} 页不应裁切文字`);
      }
    });

    await t.test('快捷键有边界，目录和帮助关闭后归还焦点', async () => {
      await page.keyboard.press('Home');
      assert.equal(await page.evaluate(() => window.xiaoxian.current), 0);
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(() => window.xiaoxian.current), 0);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => window.xiaoxian.current), 2);
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => window.xiaoxian.current), count - 1);
      await page.locator('#outline-button').click();
      assert.equal(await page.locator('#outline-dialog').evaluate(el => el.open), true);
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(() => window.xiaoxian.current), count - 1, '弹层中不应翻页');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'outline-button');
      await page.keyboard.press('o');
      await page.keyboard.press('o');
      assert.equal(await page.locator('#outline-dialog').evaluate(el => el.open), false);
      await page.locator('#help-button').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'help-button');
      await page.keyboard.press('Home');
      await page.locator('#next').focus();
      await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => window.xiaoxian.current), 1, '按钮空格应只触发一次');
    });

    await t.test('URL 页码重新打开时可恢复，动态偏好得到尊重', async () => {
      await page.goto(`${pathToFileURL(demo).href}#slide-4`);
      await page.waitForFunction(() => window.xiaoxian?.ready);
      assert.equal(await page.evaluate(() => window.xiaoxian.current), 3);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.slide.active').evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    });

    await t.test('全屏可进入退出，触摸滑动可翻页', async () => {
      await page.keyboard.press('f');
      await page.waitForFunction(() => Boolean(document.fullscreenElement));
      await page.keyboard.press('f');
      await page.waitForFunction(() => !document.fullscreenElement);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 1000, y: 400 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 650, y: 400 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => window.xiaoxian.current === 4);
      await page.evaluate(() => window.xiaoxian.go(3));
      await cdp.detach();
    });

    await t.test('讲者窗口双向翻页，同一文件的独立演示互不干扰', async () => {
      const popupWait = page.waitForEvent('popup');
      await page.locator('#presenter-button').click();
      const presenter = await popupWait;
      await presenter.waitForFunction(() => window.xiaoxian?.ready);
      assert.equal(await presenter.evaluate(() => window.xiaoxian.current), 3);
      await presenter.locator('#presenter-next').click();
      await page.waitForFunction(() => window.xiaoxian.current === 4);
      await page.evaluate(() => window.xiaoxian.go(1));
      await presenter.waitForFunction(() => window.xiaoxian.current === 1);
      assert.ok((await presenter.locator('#speaker-notes').textContent()).length > 0);
      await presenter.locator('#timer-toggle').click();
      await presenter.waitForFunction(() => document.querySelector('#elapsed').textContent !== '00:00', null, { timeout: 5000 });
      await presenter.locator('#timer-toggle').click();
      await presenter.locator('#timer-reset').click();
      assert.equal(await presenter.locator('#elapsed').textContent(), '00:00');
      const separate = await context.newPage();
      await separate.goto(`${pathToFileURL(demo).href}#slide-1`);
      await separate.waitForFunction(() => window.xiaoxian?.ready);
      await page.evaluate(() => window.xiaoxian.go(5));
      await presenter.waitForFunction(() => window.xiaoxian.current === 5);
      assert.equal(await separate.evaluate(() => window.xiaoxian.current), 0);
      await separate.close();
      await presenter.close();
    });

    await t.test('窄屏保留完整画面，打印显示所有页面并隐藏控件', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.querySelector('#stage').getBoundingClientRect().width <= innerWidth + 1);
      const bounds = await page.locator('#stage').boundingBox();
      assert.ok(bounds.width <= 391 && bounds.height <= 768);
      await page.emulateMedia({ media: 'print' });
      const printable = await page.locator('.slide').evaluateAll(nodes => nodes.filter(el => getComputedStyle(el).visibility === 'visible').length);
      assert.equal(printable, count);
      assert.equal(await page.locator('#toolbar').evaluate(el => getComputedStyle(el).display), 'none');
    });
    assert.deepEqual(errors, [], '浏览器不应发生脚本异常');
  } finally {
    await browser.close();
  }
});
