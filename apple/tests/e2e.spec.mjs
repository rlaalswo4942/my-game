// 브라우저 테스트: npm run e2e   (Playwright 1.63 + Chromium)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));   // my-game 폴더
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
let server, base, browser;

before(async () => {
  server = http.createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (path.endsWith("\\") || path.endsWith("/")) path += "index.html";
    try {
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/apple/`;
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.close(); });

async function openGame(contextOpts = {}) {
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.clock.install({ time: new Date("2026-10-15T12:00:00+09:00") });
  await page.goto(base);
  await page.click("#startBtn");
  await page.waitForFunction(() => window.__apple.engine?.status === "PLAYING");
  return { ctx, page, errors };
}

// 페이지 안에서 규칙 모듈로 유효/무효 사각형과 예상 점수 계산
const findRect = (page, wantValid) => page.evaluate(async (wantValid) => {
  const R = await import("./rules.js");
  const b = window.__apple.engine.board;
  if (wantValid) {
    const rect = R.findAnyValidRectangle(b);
    return { rect, earned: R.evaluateSelection(b, rect).earned };
  }
  for (let r = 0; r < 10; r++) for (let c = 0; c < 16; c++) {
    const rect = { r0: r, r1: r, c0: c, c1: c + 1 };
    if (!R.evaluateSelection(b, rect).valid) return { rect, earned: 0 };
  }
}, wantValid);

async function cellCenter(page, row, col) {
  const box = await page.locator("#board").boundingBox();
  return { x: box.x + (col + 0.5) * box.width / 17, y: box.y + (row + 0.5) * box.height / 10 };
}

async function mouseDrag(page, from, to, opts = {}) {
  const a = await cellCenter(page, from[0], from[1]);
  const b = to.raw ?? await cellCenter(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down(opts);
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up(opts);
}

const score = (page) => page.evaluate(() => window.__apple.engine.score);
const liveCount = (page) => page.locator(".cell:not(.empty)").count();

test("시작: 170개 사과, ★ 보너스 2개, 콘솔 에러 없음", async () => {
  const { ctx, page, errors } = await openGame();
  assert.equal(await page.locator(".cell").count(), 170);
  assert.equal(await liveCount(page), 170);
  assert.equal(await page.locator(".cell.bonus").count(), 2);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("13. 네 방향 드래그, 무효·우클릭·pointercancel·중복 pointerup·재시작 중 드래그는 무시", async () => {
  const { ctx, page, errors } = await openGame();
  // 유효 드래그 (끝→시작 역방향)
  let { rect, earned } = await findRect(page, true);
  await mouseDrag(page, [rect.r1, rect.c1], [rect.r0, rect.c0]);
  assert.equal(await score(page), earned, "역방향 드래그도 같은 사각형");
  // 다른 대각 방향
  ({ rect, earned } = await findRect(page, true));
  const s1 = await score(page);
  await mouseDrag(page, [rect.r0, rect.c1], [rect.r1, rect.c0]);
  assert.equal(await score(page), s1 + earned);

  // 무효 선택
  const s2 = await score(page);
  const live = await liveCount(page);
  const bad = await findRect(page, false);
  await mouseDrag(page, [bad.rect.r0, bad.rect.c0], [bad.rect.r1, bad.rect.c1]);
  assert.equal(await score(page), s2);
  assert.equal(await liveCount(page), live, "무효면 보드 불변");

  // 우클릭 드래그
  ({ rect } = await findRect(page, true));
  await mouseDrag(page, [rect.r0, rect.c0], [rect.r1, rect.c1], { button: "right" });
  assert.equal(await score(page), s2);

  // pointercancel 후 손을 떼도 판정 없음
  const a = await cellCenter(page, rect.r0, rect.c0), b = await cellCenter(page, rect.r1, rect.c1);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 3 });
  await page.evaluate(() => document.getElementById("board")
    .dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true })));
  await page.mouse.up();
  assert.equal(await score(page), s2, "pointercancel");

  // 중복 pointerup: 한 번만 판정
  ({ rect, earned } = await findRect(page, true));
  await mouseDrag(page, [rect.r0, rect.c0], [rect.r1, rect.c1]);
  await page.evaluate(() => document.getElementById("board")
    .dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true })));
  assert.equal(await score(page), s2 + earned, "중복 pointerup");

  // 드래그 도중 재시작 → 이전 드래그는 무시, 새 게임 0점
  ({ rect } = await findRect(page, true));
  const c = await cellCenter(page, rect.r0, rect.c0), d = await cellCenter(page, rect.r1, rect.c1);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(d.x, d.y, { steps: 3 });
  await page.evaluate(() => document.getElementById("startBtn").click());
  await page.waitForFunction(() => window.__apple.engine.score === 0 && document.getElementById("startBtn").textContent === "다시 시작");
  await page.mouse.up();
  assert.equal(await score(page), 0, "재시작 전 드래그가 새 게임에 점수를 주면 안 됨");
  assert.equal(await liveCount(page), 170);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test("보드 밖으로 끌면 가장자리로 제한", async () => {
  const { ctx, page } = await openGame();
  const box = await page.locator("#board").boundingBox();
  const expected = await page.evaluate(async () => {
    const R = await import("./rules.js");
    return R.evaluateSelection(window.__apple.engine.board, { r0: 0, r1: 9, c0: 12, c1: 16 });
  });
  await mouseDrag(page, [0, 12], { raw: { x: box.x + box.width + 300, y: box.y + box.height + 300 } });
  assert.equal(await score(page), expected.earned);
  await ctx.close();
});

test("14. 119.9초까지 플레이, 120초에 종료·결과 모달, 20초 보너스 이벤트", async () => {
  const { ctx, page } = await openGame();
  await page.clock.fastForward(20_000); await page.clock.runFor(100);
  assert.equal(await page.locator(".cell.bonus").count(), 3, "20초 보너스 승격");
  await page.clock.fastForward(99_600); await page.clock.runFor(100);   // 119.8초
  assert.equal(await page.evaluate(() => window.__apple.engine.status), "PLAYING");
  assert.equal(await page.textContent("#time"), "0:01");
  await page.clock.runFor(400);                          // 120.2초
  await page.waitForSelector("#resultDlg[open]");
  assert.equal(await page.textContent("#time"), "0:00");
  const before = await score(page);
  await page.click("#resultDlg button[value=close]");
  const { rect } = await findRect(page, true);
  await mouseDrag(page, [rect.r0, rect.c0], [rect.r1, rect.c1]);
  assert.equal(await score(page), before, "종료 후 드래그는 점수 없음");
  await ctx.close();
});

test("14. 창 크기 변경 후에도 셀 판정 정확", async () => {
  const { ctx, page } = await openGame({ viewport: { width: 1280, height: 900 } });
  await page.setViewportSize({ width: 700, height: 600 });
  const { rect, earned } = await findRect(page, true);
  await mouseDrag(page, [rect.r0, rect.c0], [rect.r1, rect.c1]);
  assert.equal(await score(page), earned);
  await ctx.close();
});

for (const [name, viewport] of [["세로", { width: 390, height: 844 }], ["가로", { width: 844, height: 390 }]]) {
  test(`15. 모바일 ${name}: 터치 드래그, 가로 스크롤·글자 잘림 없음`, async () => {
    const { ctx, page, errors } = await openGame({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const { rect, earned } = await findRect(page, true);
    const a = await cellCenter(page, rect.r0, rect.c0), b = await cellCenter(page, rect.r1, rect.c1);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
    await touch("touchStart", a);
    await touch("touchMove", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    await touch("touchMove", b);
    await touch("touchEnd");
    assert.equal(await score(page), earned, "터치 드래그");
    const layout = await page.evaluate(() => {
      const apples = [...document.querySelectorAll(".cell:not(.empty) .apple")];
      return {
        hScroll: document.documentElement.scrollWidth > window.innerWidth,
        clipped: apples.filter((el) => {                 // 숫자 글자가 사과 원 안에 다 들어가는지 (★ 배지는 일부러 밖으로 나옴)
          const range = document.createRange(); range.selectNodeContents(el);
          const t = range.getBoundingClientRect(), a = el.getBoundingClientRect();
          return t.left < a.left - 0.5 || t.right > a.right + 0.5 || t.top < a.top - 0.5 || t.bottom > a.bottom + 0.5;
        }).length,
        boardFits: document.getElementById("board").getBoundingClientRect().right <= window.innerWidth,
      };
    });
    assert.deepEqual(layout, { hScroll: false, clipped: 0, boardFits: true });
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}

test("연습 기록: 로컬 최고 점수 저장, 랭킹 탭은 온라인 미설정 안내", async () => {
  const { ctx, page } = await openGame();
  const { rect, earned } = await findRect(page, true);
  await mouseDrag(page, [rect.r0, rect.c0], [rect.r1, rect.c1]);
  await page.clock.fastForward(121_000); await page.clock.runFor(100);
  await page.waitForSelector("#resultDlg[open]");
  assert.equal(await page.textContent("#resScore"), String(earned));
  await page.click("#resultDlg button[value=rank]");
  await page.waitForSelector("#rankDlg[open]");
  assert.match(await page.textContent("#rankMsg"), /연습 기록/);
  assert.equal(await page.locator("#rankTable tbody tr").count(), 1);
  await page.click('.tabs [data-scope="daily"]');
  assert.match(await page.textContent("#rankMsg"), /연결되지 않았/);
  assert.equal(await page.textContent("#best"), String(earned));
  assert.equal(await page.$eval('#modeSel option[value="ranked"]', (o) => o.disabled), true, "미설정이면 랭킹 모드 선택 불가");
  await ctx.close();
});
