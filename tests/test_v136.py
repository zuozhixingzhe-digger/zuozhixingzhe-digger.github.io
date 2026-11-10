"""0.0.1.36：标题栏的三态——单击 / 双击 / 拖动。

问题：最大化之后**单击**标题条就把窗口还原了。
根因在 `_startDrag()`：pointerdown 那一刻只要 `mode !== 'normal'` 就立刻
`maxMode(id,'normal')`（那是为了让「最大化时也能拖下来」），于是「点一下」和
「按住拖」走了同一条路——单击也还原。

现在把还原推迟到 `draw()` 里第一次越过 3px 阈值的瞬间（`detachFromMax()`）：
- **单击**（不移动）→ 什么都不做，仍是最大化；
- **双击** → `dblclick`（鼠标）/ 340ms 内两次 tap（触屏）→ 还原；
- **按住拖** → 先按指针位置退成普通窗口，再跟手。
"""

import asyncio
import json
import sys

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8787/"
BOOT = "typeof WindowManager!=='undefined'&&TerminalManager.desktop"


async def mouse_case(browser):
    pg = await browser.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:180]))
    await pg.goto(BASE, wait_until="load")
    await pg.wait_for_function(BOOT, timeout=25000)
    await pg.wait_for_timeout(1400)

    pt = await pg.evaluate("""async () => {
      const w = [...WindowManager.windows.values()][0];
      WindowManager.maxMode(w.id, 'max');
      await sleep(500);
      const r = w.el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 18) };
    }""")

    out = {"pt": pt}

    # ① 单击：必须还是最大化
    await pg.mouse.click(pt["x"], pt["y"])
    await pg.wait_for_timeout(420)
    out["click"] = await pg.evaluate(
        "() => { const w = [...WindowManager.windows.values()][0];"
        " return { mode: w.mode, maximized: w.maximized }; }")

    # ② 双击：还原
    await pg.mouse.dblclick(pt["x"], pt["y"])
    await pg.wait_for_timeout(520)
    out["dblclick"] = await pg.evaluate("""() => {
      const w = [...WindowManager.windows.values()][0];
      const r = w.el.getBoundingClientRect();
      return { mode: w.mode, maximized: w.maximized,
               rect: [r.x, r.y, r.width, r.height].map(Math.round) };
    }""")

    # ③ 再双击：回最大化
    await pg.mouse.dblclick(pt["x"], pt["y"])
    await pg.wait_for_timeout(520)
    out["dblclick2"] = await pg.evaluate(
        "() => { const w = [...WindowManager.windows.values()][0];"
        " return { mode: w.mode, maximized: w.maximized }; }")

    # ④ 最大化时按住拖 60px：退成普通窗口并跟手
    await pg.mouse.move(pt["x"], pt["y"])
    await pg.mouse.down()
    await pg.wait_for_timeout(60)
    for i in range(1, 7):
        await pg.mouse.move(pt["x"] + i * 10, pt["y"] + i * 10)
        await pg.wait_for_timeout(20)
    await pg.wait_for_timeout(120)
    mid = await pg.evaluate("() => { const w = [...WindowManager.windows.values()][0];"
                            " return { mode: w.mode, dragging: w.el.classList.contains('dragging') }; }")
    await pg.mouse.up()
    await pg.wait_for_timeout(420)
    end = await pg.evaluate("""() => {
      const w = [...WindowManager.windows.values()][0];
      const r = w.el.getBoundingClientRect();
      return { mode: w.mode, rect: [r.x, r.y, r.width, r.height].map(Math.round) };
    }""")
    out["drag"] = {"mid": mid, "end": end}
    await pg.screenshot(path="/workspace/fix-click-title.png")
    await pg.close()

    ok = True
    if out["click"]["mode"] != "max" or not out["click"]["maximized"]:
        ok = False
    if out["dblclick"]["mode"] != "normal" or out["dblclick"]["maximized"]:
        ok = False
    if out["dblclick2"]["mode"] != "max":
        ok = False
    if mid["mode"] != "normal" or not mid["dragging"]:
        ok = False
    if end["mode"] != "normal":
        ok = False
    # 拖动应该真的移动了（起始位置按指针居中，之后 +60,+60）
    if abs(end["rect"][0] - out["dblclick"]["rect"][0]) < 40:
        ok = False
    if errs:
        ok = False
    return ok, {"mouse": out, "errs": errs[:3]}


async def touch_case(browser):
    ctx = await browser.new_context(viewport={"width": 390, "height": 844},
                                    is_mobile=True, has_touch=True)
    pg = await ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:180]))
    await pg.goto(BASE, wait_until="load")
    await pg.wait_for_function(BOOT, timeout=25000)
    await pg.wait_for_timeout(1500)

    pt = await pg.evaluate("""async () => {
      const w = [...WindowManager.windows.values()][0];
      WindowManager.maxMode(w.id, 'max');
      await sleep(500);
      const r = w.el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 16) };
    }""")

    out = {"pt": pt}
    # ① 单击：不变
    await pg.touchscreen.tap(pt["x"], pt["y"])
    await pg.wait_for_timeout(480)     # 超过 340ms 的计数窗口，确保是「两次独立的单击」
    out["tap1"] = await pg.evaluate("() => { const w = [...WindowManager.windows.values()][0]; return { mode: w.mode }; }")

    # ② 双击（两次 tap 间隔 120ms）：还原
    await pg.touchscreen.tap(pt["x"], pt["y"])
    await pg.wait_for_timeout(120)
    await pg.touchscreen.tap(pt["x"], pt["y"])
    await pg.wait_for_timeout(620)
    out["doubleTap"] = await pg.evaluate("""() => {
      const w = [...WindowManager.windows.values()][0];
      const r = w.el.getBoundingClientRect();
      return { mode: w.mode, rect: [r.x, r.y, r.width, r.height].map(Math.round) };
    }""")

    # ③ 再双击：回最大化
    await pg.touchscreen.tap(pt["x"], pt["y"])
    await pg.wait_for_timeout(120)
    await pg.touchscreen.tap(pt["x"], pt["y"])
    await pg.wait_for_timeout(620)
    out["doubleTap2"] = await pg.evaluate("() => { const w = [...WindowManager.windows.values()][0]; return { mode: w.mode }; }")
    await ctx.close()

    ok = True
    if out["tap1"]["mode"] != "max":
        ok = False
    if out["doubleTap"]["mode"] != "normal":
        ok = False
    if out["doubleTap"]["rect"][2] < 280 or out["doubleTap"]["rect"][3] < 200:
        ok = False
    if out["doubleTap2"]["mode"] != "max":
        ok = False
    if errs:
        ok = False
    return ok, {"touch": out, "errs": errs[:3]}


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        ok1, r1 = await mouse_case(b)
        ok2, r2 = await touch_case(b)
        await b.close()

    print("鼠标")
    print(json.dumps(r1, ensure_ascii=False, indent=1))
    print("触屏")
    print(json.dumps(r2, ensure_ascii=False, indent=1))
    print()
    print("PASS 鼠标单击不还原 / 双击还原 / 拖动才还原" if ok1 else "FAIL 鼠标三态")
    print("PASS 触屏单击不还原 / 双击还原" if ok2 else "FAIL 触屏三态")
    return 0 if (ok1 and ok2) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
