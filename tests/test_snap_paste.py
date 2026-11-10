import asyncio, json
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8787/"
CODE = '''// 选中页面中所有"按钮类"元素，并把它们背景变红
(function () {
  // 1. 原生 <button>
  const nativeButtons = document.querySelectorAll('button');

  if (nativeButtons.length === 0) {
    console.warn('no buttons');
    return;
  }
  nativeButtons.forEach((el) => {
    el.style.setProperty('background-color', 'red', 'important');
  });
  console.log('done ' + nativeButtons.length);
})();
'''

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1400, "height": 880})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function("typeof TerminalManager !== 'undefined' && TerminalManager.desktop", timeout=25000)
        await pg.wait_for_timeout(900)
        out = {}

        # ---------- A. 吸附：指针位置判定（0.0.1.33 起） ----------
        async def setup_win():
            return await pg.evaluate("""async () => {
              const w = WindowManager.open({type:'editor', content:'x'});
              await sleep(400);
              w.el.style.left = '600px'; w.el.style.top = '200px';
              await sleep(120);
              const r = w.el.getBoundingClientRect();
              const b = w.el.querySelector('.win-bar').getBoundingClientRect();
              return { id: w.id, gx: r.left + r.width/2, gy: b.top + b.height/2 };
            }""")

        async def drag_pointer(win, tx, ty):
            """抓住标题条中央，把**指针**拖到 (tx, ty)"""
            await pg.mouse.move(win["gx"], win["gy"])
            await pg.mouse.down()
            for i in range(1, 11):
                await pg.mouse.move(win["gx"] + (tx - win["gx"]) * i / 10,
                                    win["gy"] + (ty - win["gy"]) * i / 10)
                await pg.wait_for_timeout(20)
            await pg.wait_for_timeout(180)
            return await pg.evaluate("""() => {
              const s = document.querySelector('.win-snap');
              return { pos: s && s.style.display !== 'none' ? s.dataset.pos : null };
            }""")

        # 1) 窗口已经贴左（left=2），但指针还在窗口中间 —— 不该吸附
        win = await setup_win()
        await pg.evaluate("""(id) => { const w = WindowManager.windows.get(id); w.el.style.left = '2px'; }""", win["id"])
        st = await drag_pointer(win, 600, 260)
        await pg.mouse.up(); await pg.wait_for_timeout(400)
        out["pointer_mid"] = st

        # 2) 指针拖到左缘 2px —— 应该吸附 left
        win = await setup_win()
        st = await drag_pointer(win, 2, 260)
        await pg.mouse.up(); await pg.wait_for_timeout(500)
        mode = await pg.evaluate("""(id) => {
          const w = WindowManager.windows.get(id);
          return w ? {mode: w.mode, x: Math.round(parseFloat(w.el.style.left)),
                      w: Math.round(parseFloat(w.el.style.width))} : null;
        }""", win["id"])
        out["pointer_edge_left"] = {"snap": st, "after": mode}

        # 3) 指针离左缘 30px —— 不该吸附
        win = await setup_win()
        st = await drag_pointer(win, 30, 260)
        await pg.mouse.up(); await pg.wait_for_timeout(400)
        out["pointer_30px"] = st

        # 4) 指针拖到右缘 —— 应该吸附 right
        win = await setup_win()
        st = await drag_pointer(win, 1398, 260)
        await pg.mouse.up(); await pg.wait_for_timeout(500)
        mode = await pg.evaluate("""(id) => {
          const w = WindowManager.windows.get(id);
          return w ? {mode: w.mode, x: Math.round(parseFloat(w.el.style.left)),
                      w: Math.round(parseFloat(w.el.style.width))} : null;
        }""", win["id"])
        out["pointer_edge_right"] = {"snap": st, "after": mode}

        # 清理窗口
        await pg.evaluate("""() => { for (const w of [...WindowManager.windows.values()]) if (w.type !== 'shell') WindowManager.close(w.id); }""")
        await pg.wait_for_timeout(500)

        # ---------- B. 手机粘贴：不带括号标记的多行文本 ----------
        out["paste"] = await pg.evaluate("""async (code) => {
          const t = TerminalManager.desktop;
          t.worker.postMessage({t:'in', data:'\\x03'});
          await sleep(250);
          /* 手机输入法粘贴：一次一整段，没有 \\x1b[200~ 标记 */
          t.worker.postMessage({t:'in', data: code});
          await sleep(900);
          const ed = t.worker && t.worker.__ed;
          /* 从屏幕读回来判断是否执行（看到 done 或 no buttons 即为执行过） */
          const buf = t.term.buffer.active;
          const rows = [];
          for (let i = Math.max(0, buf.length - 40); i < buf.length; i++) {
            const l = buf.getLine(i); if (l) rows.push(l.translateToString(true));
          }
          return rows.join('\\n').slice(-600);
        }""", CODE)

        # ---------- C. 手机粘贴后没有残留半截 ----------
        out["paste2"] = await pg.evaluate("""async () => {
          const t = TerminalManager.desktop;
          const buf = t.term.buffer.active;
          const last = [];
          for (let i = Math.max(0, buf.length - 6); i < buf.length; i++) {
            const l = buf.getLine(i); if (l) last.push(l.translateToString(true));
          }
          return last.filter(Boolean).slice(-4);
        }""")

        out["errs"] = errs
        print(json.dumps(out, ensure_ascii=False, indent=1))
        await b.close()

asyncio.run(main())
