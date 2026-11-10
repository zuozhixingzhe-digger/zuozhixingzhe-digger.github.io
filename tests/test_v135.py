"""0.0.1.35 补丁回归：还原尺寸 + 「最后一扇还在最小化里」。

两个都来自用户截图：

① 手机尺寸下把启动那扇终端从「隐藏式最大化」还原，窗口变成一条几乎看不见的窗缝。
   根因：bootDesktop() 是 open() 之后**同步**调 maxMode(hidden) 的，而入场动画是
   @keyframes htWinIn{from{transform:scale(.06)}}——那 260ms 里 getBoundingClientRect()
   拿到的是被 transform 缩小后的尺寸，于是 restoreRect 记成了几十像素。
   现在 open() 直接带着已知的布局尺寸，maxMode 也改用 offset*（不受 transform 影响）。

② 两扇窗，收一扇 → 关掉另一扇，剩下那扇还在最小化里；此时窗口只剩一个、Dock 按规则
   不显示，它就没有任何入口回来了（用户看到的是一张空白页）。
   现在 minimize() 要求「收完之后至少还有一扇看得见的」；_syncDock() 再兜一层：
   万一真出现「全在最小化」，强制把最后一扇放出来。
"""

import asyncio
import json
import sys

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8787/"
BOOT = "typeof WindowManager!=='undefined'&&TerminalManager.desktop"


async def scenario_restore(browser):
    """手机尺寸：启动那扇终端还原后必须是正常大小的窗口。"""
    ctx = await browser.new_context(viewport={"width": 390, "height": 844},
                                    is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    await pg.goto(BASE, wait_until="load")
    await pg.wait_for_function(BOOT, timeout=25000)
    await pg.wait_for_timeout(1400)

    boot = await pg.evaluate("""() => {
      const w = [...WindowManager.windows.values()][0];
      return { mode: w.mode, restore: w.restoreRect };
    }""")

    back = await pg.evaluate("""async () => {
      const w = [...WindowManager.windows.values()][0];
      WindowManager.maxMode(w.id, 'normal');
      await sleep(500);
      const r = w.el.getBoundingClientRect();
      const term = w.el.querySelector('.xterm');
      const tb = term && term.getBoundingClientRect();
      return {
        mode: w.mode,
        rect: [r.x, r.y, r.width, r.height].map(Math.round),
        restore: w.restoreRect,
        hasTerm: !!term,
        termBox: tb ? [Math.round(tb.width), Math.round(tb.height)] : null,
        overflowX: document.body.scrollWidth > document.documentElement.clientWidth
      };
    }""")

    await pg.screenshot(path="/workspace/fix-restore-phone.png")
    await ctx.close()

    ok = True
    # 窗口至少 280×200（.win 的 min-width / min-height 就是这条线）
    if back["rect"][2] < 280 or back["rect"][3] < 200:
        ok = False
    # 位置别跑到桌面外
    if back["rect"][0] < 0 or back["rect"][1] < 0:
        ok = False
    if not back["hasTerm"]:
        ok = False
    if back["overflowX"]:
        ok = False
    if back["restore"]["w"] < 280 or back["restore"]["h"] < 200:
        ok = False
    if errs:
        ok = False
    return ok, {"boot": boot, "restore": back, "errs": errs[:3]}


async def scenario_solo(browser):
    """两扇 → 收一扇 → 关另一扇：剩下的必须被放出来，不能留空白。"""
    pg = await browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    await pg.goto(BASE, wait_until="load")
    await pg.wait_for_function(BOOT, timeout=25000)
    await pg.wait_for_timeout(1400)

    out = await pg.evaluate("""async () => {
      const r = {};
      const T = [...WindowManager.windows.values()][0];
      const w2 = WindowManager.open({ type: 'timer' });
      await sleep(600);
      r.two = { size: WindowManager.windows.size,
                dockVisible: !document.getElementById('dockWrap').hidden };

      /* ① 收 timer：允许，终端还看得见 */
      WindowManager.minimize(w2.id);
      await sleep(500);
      r.min1 = { minimized: w2.minimized, size: WindowManager.windows.size,
                 dockItems: document.querySelectorAll('#dock [data-win]').length };

      /* ② 再收终端：收完桌面上就一扇看得见的都没有了，必须拒绝 */
      WindowManager.minimize(T.id);
      await sleep(300);
      r.min2 = { rejected: !T.minimized,
                 anyVisible: [...WindowManager.windows.values()].some(x => !x.minimized) };

      /* ③ 关掉终端：剩下的 timer 还在最小化里 → 必须被强制放出来 */
      WindowManager.close(T.id);
      await sleep(800);
      const only = [...WindowManager.windows.values()];
      r.afterClose = {
        size: only.length,
        minimized: only.map(x => x.minimized),
        live: only.map(x => !x.minimized && !x.el.classList.contains('min')),
        dockHidden: document.getElementById('dockWrap').hidden,
        dockItems: document.querySelectorAll('#dock [data-win]').length,
        solo: only.map(x => x.el.classList.contains('solo')),
        redPath: only.length ? (only[0].el.querySelector('.win-dot.c svg path') || {}).getAttribute?.('d') : null
      };
      r.winEls = document.querySelectorAll('#window-layer .win').length;
      return r;
    }""")

    await pg.screenshot(path="/workspace/fix-solo-restore.png")

    ok = True
    if out["two"]["size"] != 2 or not out["two"]["dockVisible"]:
        ok = False
    if not out["min1"]["minimized"] or out["min1"]["dockItems"] != 2:
        ok = False
    if not out["min2"]["rejected"] or not out["min2"]["anyVisible"]:
        ok = False
    ac = out["afterClose"]
    if ac["size"] != 1 or ac["minimized"] != [False] or ac["live"] != [True]:
        ok = False
    if not ac["dockHidden"] or ac["dockItems"] != 0 or ac["solo"] != [True]:
        ok = False
    if ac["redPath"] != "M 30 6 L 8 20 L 30 34 Z":
        ok = False
    if out["winEls"] != 1:
        ok = False

    await pg.close()
    if errs:
        ok = False
    return ok, {"solo": out, "errs": errs[:3]}


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        ok1, r1 = await scenario_restore(b)
        ok2, r2 = await scenario_solo(b)
        await b.close()

    print("① 还原尺寸")
    print(json.dumps(r1, ensure_ascii=False, indent=1))
    print("② 最后一扇还在最小化里")
    print(json.dumps(r2, ensure_ascii=False, indent=1))
    print()
    print("PASS 还原尺寸" if ok1 else "FAIL 还原尺寸")
    print("PASS 单窗强制恢复" if ok2 else "FAIL 单窗强制恢复")
    return 0 if (ok1 and ok2) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
