"""0.0.1.37：彻底全屏时，顶栏和 Dock 必须真的消失。

问题：进入「彻底全屏」后，最上面仍压着一条 54px 的顶栏（地球、全屏按钮…）。

根因不在 JS，而在 CSS：0.0.1.34 把底部终端整块删掉时，顺手删了
`body.immersive #term-view{opacity:0;pointer-events:none}` 这一条规则，
但**只删了选择器和声明块的一半**——`body.immersive .topbar, #dock, #dockWrap,
#dockPill,` 这四行留着逗号，跟下面 `body.immersive{background:#000}` 拼成了
一个选择器列表。于是「隐藏顶栏 / Dock」整条声明消失，只剩给它们刷黑底；
顶栏还是 flex、还是 54px 高、层级又比窗口高，就在全屏画面上压出一条黑边。

修法：把这四行接回一个真正的声明块 `{display:none!important}`。
顺带补上 `body.fs`（浏览器拒绝 requestFullscreen 时的软件级全屏）——
README 一直写着「隐藏顶栏、桌面铺满」，但样式从来没写过。

本测试盯四件事：
1. 彻底全屏：topbar / dock / dockWrap / dockPill 全部 display:none，
   窗口矩形正好铺满 viewport；
2. 退出后顶栏回来，窗口回到普通形态；
3. 悬浮球点击也能退出（不是只有菜单能退）；
4. 软件级全屏 body.fs 同样不留顶栏，移除类后恢复。
"""

import asyncio
import json
import sys

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8787/?v=137"
BOOT = "typeof WindowManager!=='undefined'&&TerminalManager.desktop"

MEASURE = """() => {
  const tb = document.querySelector('.topbar');
  const dock = document.getElementById('dock');
  const wrap = document.getElementById('dockWrap');
  const pill = document.getElementById('dockPill');
  const ball = document.getElementById('imBall');
  const w = [...WindowManager.windows.values()].find(x => x.mode === 'immersive') ||
            [...WindowManager.windows.values()][0];
  const r = w.el.getBoundingClientRect();
  const cs = (el) => el ? getComputedStyle(el) : null;
  return {
    body: document.body.className,
    mode: w.mode,
    win: [r.x, r.y, r.width, r.height].map(Math.round),
    topbar: cs(tb).display,
    topbarH: Math.round(tb.getBoundingClientRect().height),
    dock: cs(dock).display,
    wrap: wrap ? cs(wrap).display : null,
    pill: pill ? cs(pill).display : null,
    ball: cs(ball).display,
    overflowX: document.documentElement.scrollWidth - innerWidth,
    viewport: [innerWidth, innerHeight]
  };
}"""


async def desktop_case(browser):
    pg = await browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:180]))
    await pg.goto(BASE, wait_until="load")
    await pg.wait_for_function(BOOT, timeout=25000)
    await pg.wait_for_timeout(1500)

    # 先开第二扇窗，让 Dock 处于「显示」状态——否则测不出「全屏时被藏掉」
    await pg.evaluate("""() => {
      const w = [...WindowManager.windows.values()][0];
      WindowManager.open({ type: 'timer', title: '计时器' });
      WindowManager.focus(w.id);
    }""")
    await pg.wait_for_timeout(500)
    out = {"before": await pg.evaluate(MEASURE)}
    assert out["before"]["dock"] != "none", "测试前置失败：两扇窗时 Dock 应该是显示的"

    # ① 进入彻底全屏
    await pg.evaluate("""() => {
      const w = [...WindowManager.windows.values()].find(x => x.type === 'shell');
      WindowManager.maxMode(w.id, 'immersive');
    }""")
    await pg.wait_for_timeout(900)
    out["im"] = await pg.evaluate(MEASURE)
    await pg.screenshot(path="/workspace/fix-im-chrome.png")

    # ② 悬浮球点击退出
    ball = await pg.evaluate("""() => {
      const r = document.getElementById('imBall').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }""")
    await pg.mouse.click(ball["x"], ball["y"])
    await pg.wait_for_timeout(700)
    out["afterBall"] = await pg.evaluate(MEASURE)

    # ③ 再进一次，用 exitImmersive()（顶栏全屏按钮走的就是这条）退出
    await pg.evaluate("""() => {
      const w = [...WindowManager.windows.values()].find(x => x.type === 'shell');
      WindowManager.maxMode(w.id, 'immersive');
    }""")
    await pg.wait_for_timeout(600)
    await pg.evaluate("() => WindowManager.exitImmersive()")
    await pg.wait_for_timeout(700)
    out["afterExit"] = await pg.evaluate(MEASURE)

    # ④ 软件级全屏（浏览器拒绝 requestFullscreen 时的兜底）
    await pg.evaluate("() => document.body.classList.add('fs')")
    await pg.wait_for_timeout(250)
    out["fs"] = await pg.evaluate(MEASURE)
    await pg.evaluate("() => document.body.classList.remove('fs')")
    await pg.wait_for_timeout(250)
    out["fsOff"] = await pg.evaluate(MEASURE)

    await pg.close()

    ok = True
    im = out["im"]
    if im["mode"] != "immersive":
        ok = False
    if im["topbar"] != "none" or im["topbarH"] != 0:
        ok = False
    if im["dock"] != "none" or im["wrap"] != "none":
        ok = False
    if im["pill"] != "none":
        ok = False
    if im["win"] != [0, 0, 1280, 800]:
        ok = False
    if im["ball"] == "none":
        ok = False
    if out["afterBall"]["topbar"] == "none" or out["afterBall"]["mode"] == "immersive":
        ok = False
    if out["afterBall"]["dock"] == "none":
        ok = False
    if out["afterExit"]["topbar"] == "none":
        ok = False
    if out["fs"]["topbar"] != "none" or out["fs"]["dock"] != "none":
        ok = False
    if out["fsOff"]["topbar"] == "none":
        ok = False
    if im["overflowX"] > 0:
        ok = False
    if errs:
        ok = False
    return ok, {"desktop": out, "errs": errs[:3]}


async def phone_case(browser):
    ctx = await browser.new_context(viewport={"width": 390, "height": 844},
                                    is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:180]))
    await pg.goto(BASE, wait_until="load")
    await pg.wait_for_function(BOOT, timeout=25000)
    await pg.wait_for_timeout(1500)

    await pg.evaluate("""() => {
      const w = [...WindowManager.windows.values()][0];
      WindowManager.maxMode(w.id, 'immersive');
    }""")
    await pg.wait_for_timeout(800)
    im = await pg.evaluate(MEASURE)
    await pg.evaluate("() => WindowManager.exitImmersive()")
    await pg.wait_for_timeout(600)
    off = await pg.evaluate(MEASURE)
    await ctx.close()

    ok = (im["topbar"] == "none" and im["dock"] == "none"
          and im["win"] == [0, 0, 390, 844]
          and im["overflowX"] <= 0
          and off["topbar"] != "none" and not errs)
    return ok, {"phone": {"im": im, "off": off}, "errs": errs[:3]}


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        ok1, r1 = await desktop_case(b)
        ok2, r2 = await phone_case(b)
        await b.close()

    print(json.dumps(r1, ensure_ascii=False, indent=1))
    print(json.dumps(r2, ensure_ascii=False, indent=1))
    print()
    print("PASS 桌面：彻底全屏无顶栏 / 悬浮球退出 / body.fs 同步"
          if ok1 else "FAIL 桌面彻底全屏")
    print("PASS 手机：彻底全屏铺满且无横向溢出" if ok2 else "FAIL 手机彻底全屏")
    return 0 if (ok1 and ok2) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
