import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildDeck } from '../skills/xiaoxian-slides/scripts/build.mjs';

test('目录总览与讲者返回的完整流程', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xiaoxian-navigation-'));
  const content = {
    title:'一份能来回操作的演示',
    slides:Array.from({length:38}, (_, i) => ({
      layout:'statement', title:i === 0 ? '标题很长时也要完整显示，不能把关键信息截掉。'.repeat(4) : `第 ${i + 1} 个想法`,
      chapter:`第 ${Math.floor(i / 8) + 1} 部分 · 练习`,
      notes:'先讲一个具体例子，再给出一个动作。\n'.repeat(i === 12 ? 100 : 1), seconds:30
    }))
  };
  const input = path.join(dir, 'deck.json');
  const output = path.join(dir, 'deck.html');
  await writeFile(input, JSON.stringify(content));
  await buildDeck(input, output);
  const url = pathToFileURL(output).href;
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  t.after(async () => { await browser.close(); await rm(dir,{recursive:true,force:true}); });
  const ready = page => page.waitForFunction(() => window.xiaoxian?.ready);
  const modeReturned = async page => {
    await page.waitForFunction(() => !new URLSearchParams(location.search).has('presenter') && window.xiaoxian?.ready && !document.body.classList.contains('is-presenter'));
    assert.equal(new URL(page.url()).searchParams.has('instance'), false);
    assert.equal(await page.evaluate(() => window.name), '');
    assert.equal(await page.locator('#presenter').isVisible(), false);
    assert.equal(await page.locator('#elapsed').textContent(), '00:00');
  };
  const openNotes = async main => {
    const popup = main.waitForEvent('popup',{timeout:5000});
    await main.keyboard.press('p');
    const notes = await popup;
    await ready(notes);
    await notes.waitForFunction(() => document.querySelector('#connection-status').textContent.includes('已连接'));
    return notes;
  };

  await t.test('长目录定位当前页，保留标题章节与卡片高亮', async () => {
    const page = await context.newPage();
    await page.goto(`${url}#slide-38`); await ready(page);
    await page.keyboard.press('o');
    assert.equal(await page.locator('#outline-dialog').evaluate(el => el.open), true);
    const state = await page.evaluate(() => {
      const dialog=document.querySelector('#outline-dialog'), list=document.querySelector('#outline-list'), current=list.querySelector('[aria-current="page"]');
      const r=dialog.getBoundingClientRect(), back=document.querySelector('#outline-return').getBoundingClientRect();
      return {width:r.width,height:r.height,cols:getComputedStyle(list).gridTemplateColumns.split(' ').length,
        scroll:list.scrollTop,active:document.activeElement===current,background:getComputedStyle(current).backgroundColor,
        border:getComputedStyle(current).borderTopColor,backVisible:back.top>=0 && back.bottom<=innerHeight};
    });
    assert.equal(state.width,1440); assert.equal(state.height,900); assert.equal(state.cols,5);
    assert.ok(state.scroll>0 && state.active && state.backVisible);
    assert.equal(state.background,'rgb(226, 243, 75)'); assert.equal(state.border,'rgb(255, 104, 75)');
    assert.equal(await page.locator('.outline-chapter').last().textContent(),'第 5 部分 · 练习');
    await page.keyboard.press('Home');
    assert.equal(await page.locator('.outline-card-title').first().textContent(),content.slides[0].title);
    const fits = await page.locator('#outline-list button').first().evaluate(button => {
      const title=button.querySelector('.outline-card-title').getBoundingClientRect(), chapter=button.querySelector('.outline-chapter').getBoundingClientRect();
      return title.bottom <= chapter.top + 1 && chapter.bottom <= button.getBoundingClientRect().bottom;
    });
    assert.ok(fits,'长标题不能挤出卡片或覆盖章节');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.xiaoxian.current),1);
    assert.equal(await page.locator('#outline-dialog').evaluate(el => el.open),false);
    await page.close();
  });

  await t.test('目录适配桌面和手机，关闭后恢复纯净全屏', async () => {
    const page=await context.newPage(); await page.goto(`${url}#slide-3`); await ready(page);
    for (const [width,height,columns] of [[1440,900,5],[1000,800,4],[390,844,2],[320,568,1],[568,320,2]]) {
      await page.setViewportSize({width,height}); await page.keyboard.press('o');
      const result=await page.evaluate(() => {
        const list=document.querySelector('#outline-list'),back=document.querySelector('#outline-return').getBoundingClientRect();
        return {cols:getComputedStyle(list).gridTemplateColumns.split(' ').length,noOverflow:list.scrollWidth<=list.clientWidth+1,
          backVisible:back.top>=0 && back.bottom<=innerHeight && back.right<=innerWidth};
      });
      assert.equal(result.cols,columns); assert.ok(result.noOverflow && result.backVisible);
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({width:1440,height:900});
    await page.keyboard.press('f'); await page.waitForFunction(() => !!document.fullscreenElement);
    await page.keyboard.press('o');
    assert.notEqual(await page.locator('#outline-return').evaluate(el => getComputedStyle(el).cursor),'none');
    await page.locator('#outline-list button').nth(20).click();
    assert.equal(await page.evaluate(() => window.xiaoxian.current),20);
    assert.equal(await page.evaluate(() => !!document.fullscreenElement),true);
    assert.equal(await page.locator('#toolbar').evaluate(el => getComputedStyle(el).display),'none');
    assert.equal(await page.evaluate(() => document.activeElement.closest('#toolbar')===null),true);
    await page.keyboard.press('o'); await page.locator('#outline-return').click();
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.fullscreenElement);
    await page.close();
  });

  await t.test('讲者返回保留当前页，再次进入与两组窗口相互隔离', async () => {
    const main=await context.newPage(); await main.goto(`${url}#slide-3`); await ready(main);
    const returned=await openNotes(main);
    const before=context.pages().length;
    await main.keyboard.press('p');
    assert.equal(context.pages().length,before,'重复 P 复用仍在讲者模式的窗口');
    await returned.locator('#presenter-next').click(); await main.waitForFunction(() => window.xiaoxian.current===3);
    await returned.locator('#timer-toggle').click();
    await returned.waitForFunction(() => document.querySelector('#elapsed').textContent!=='00:00',null,{timeout:4000});
    await returned.locator('#presenter-return').click(); await modeReturned(returned);
    assert.equal(await returned.evaluate(() => window.xiaoxian.current),3);
    const notesA=await openNotes(main);
    const notesB=await openNotes(returned);
    assert.notEqual(notesA,returned); assert.notEqual(notesB,returned); assert.notEqual(notesA,notesB);
    await notesA.locator('#presenter-next').click(); await main.waitForFunction(() => window.xiaoxian.current===4);
    assert.equal(await returned.evaluate(() => window.xiaoxian.current),3);
    await notesB.locator('#presenter-previous').click(); await returned.waitForFunction(() => window.xiaoxian.current===2);
    assert.equal(await main.evaluate(() => window.xiaoxian.current),4);
    await notesA.keyboard.press('Escape'); await modeReturned(notesA);
    await notesB.locator('#presenter-return').click(); await modeReturned(notesB);
    for (const page of [main,returned,notesA,notesB]) await page.close();
  });

  await t.test('无原窗口或原窗口已关闭时仍能返回，Esc先退出讲者全屏', async () => {
    const orphan=await context.newPage(); await orphan.goto(`${url}?presenter=1#slide-13`); await ready(orphan);
    await orphan.setViewportSize({width:390,height:844});
    await orphan.evaluate(() => window.scrollTo(0,document.documentElement.scrollHeight));
    const back=await orphan.locator('#presenter-return').boundingBox();
    assert.ok(back.y>=0 && back.y+back.height<=844 && back.x+back.width<=390);
    await orphan.keyboard.press('f'); await orphan.waitForFunction(() => !!document.fullscreenElement);
    await orphan.keyboard.press('Escape'); await orphan.waitForFunction(() => !document.fullscreenElement);
    assert.equal(await orphan.locator('body').evaluate(el => el.classList.contains('is-presenter')),true);
    await orphan.keyboard.press('Escape'); await modeReturned(orphan);
    assert.equal(await orphan.evaluate(() => window.xiaoxian.current),12);
    const main=await context.newPage(); await main.goto(`${url}#slide-5`); await ready(main);
    const notes=await openNotes(main); await main.close();
    await notes.locator('#presenter-return').click(); await modeReturned(notes);
    assert.equal(await notes.evaluate(() => window.xiaoxian.current),4);
    await orphan.close(); await notes.close();
  });

  await t.test('弹窗被拦截时说明原因，演示仍可继续', async () => {
    const page=await context.newPage(); await page.goto(`${url}#slide-3`); await ready(page);
    await page.evaluate(() => {window.open=()=>null;}); await page.keyboard.press('p');
    assert.match(await page.locator('#status').textContent(),/被浏览器拦截/);
    await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => window.xiaoxian.current),3);
    await page.close();
  });

  await t.test('仅本地轮询可用时，返回后立即 P 仍能重新进入', async () => {
    const fallback = await browser.newContext({viewport:{width:1280,height:850}});
    await fallback.addInitScript(() => {
      window.BroadcastChannel=class {constructor(){throw new Error('disabled for transport test');}};
      window.addEventListener('message',event=>event.stopImmediatePropagation(),true);
      window.addEventListener('storage',event=>event.stopImmediatePropagation(),true);
    });
    try {
      const main=await fallback.newPage(); await main.goto(`${url}#slide-4`); await ready(main);
      await main.evaluate(() => {
        const open=window.open.bind(window);
        window.__opened=[];
        window.open=(...args)=>{const child=open(...args);window.__opened.push(child);return child;};
      });
      const notes=await openNotes(main);
      await notes.locator('#presenter-next').click(); await main.waitForFunction(()=>window.xiaoxian.current===4);
      await notes.locator('#presenter-return').click(); await modeReturned(notes);
      const reopened=await openNotes(main);
      assert.notEqual(reopened,notes);
      assert.equal(await reopened.evaluate(()=>window.xiaoxian.current),4);
      await reopened.close();
      await main.waitForFunction(()=>window.__opened.at(-1)?.closed===true,null,{timeout:5000});
      const quickPopup=main.waitForEvent('popup',{timeout:5000});
      await main.keyboard.press('p'); const quick=await quickPopup; await ready(quick);
      await quick.locator('#presenter-return').click(); await modeReturned(quick);
      const reopenedAgain=await openNotes(main);
      assert.notEqual(reopenedAgain,quick,'关闭旧讲者后快速退出新讲者，仍可再次进入');
    } finally { await fallback.close(); }
  });
});
