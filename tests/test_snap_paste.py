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

        # ---------- A. 吸附：提手位置判定 ----------
        async def drag_to(x_from_gutter, y_extra=0):
            """把窗口拖到使「提手左边缘」位于 x_from_gutter 的位置"""
            return await pg.evaluate("""async (gx) => {
              const w = WindowManager.open({type:'editor', content:'x'});
              await sleep(400);
              // 摆到一个明确的起点
              w.el.style.left = '600px'; w.el.style.top = '200px';
              await sleep(120);
              const h = w.el.querySelector('.win-handle').getBoundingClientRect();
              return {id: w.id, hx: h.x, hy: h.y, hw: h.width, hh: h.height};
            }""", x_from_gutter)

        async def drag_window(win, target_hx, target_hy):
            # 用真实鼠标：抓提手中央，拖到目标位置
            hx = win["hx"] + win["hw"] / 2
            hy = win["hy"] + win["hh"] / 2
            await pg.mouse.move(hx, hy)
            await pg.mouse.down()
            for i in range(10):
                await pg.mouse.move(hx + (target_hx + win["hw"] / 2 - hx) * (i + 1) / 10,
                                    hy + (target_hy + win["hh"] / 2 - hy) * (i + 1) / 10)
                await pg.wait_for_timeout(25)
            await pg.wait_for_timeout(200)
            st = await pg.evaluate("""() => {
              const s = document.querySelector('.win-snap');
              return {pos: s && s.style.display !== 'none' ? s.dataset.pos : null};
            }""")
            return st

        # 1) 提手离左边 30px —— 不该吸附
        win = await drag_to(0)
        st = await drag_window(win, 30, 200)
        await pg.mouse.up()
        await pg.wait_for_timeout(400)
        out["edge_30px"] = st

        # 2) 提手贴到左边 2px —— 应该吸附 left
        win = await drag_to(0)
        st = await drag_window(win, 2, 200)
        await pg.mouse.up()
        await pg.wait_for_timeout(500)
        mode = await pg.evaluate("""(id) => {
          const w = WindowManager.windows.get(id);
          return w ? {mode: w.mode, x: Math.round(parseFloat(w.el.style.left)),
                      w: Math.round(parseFloat(w.el.style.width))} : null;
        }""", win["id"])
        out["edge_2px"] = {"snap": st, "after": mode}

        # 3) 提手离右边 30px —— 不该吸附
        win = await drag_to(0)
        st = await drag_window(win, 1400 - 30 - win["hw"], 200)
        await pg.mouse.up()
        await pg.wait_for_timeout(400)
        out["right_30px"] = st

        # 4) 提手贴右边 2px —— 应该吸附 right
        win = await drag_to(0)
        st = await drag_window(win, 1400 - 2 - win["hw"], 200)
        await pg.mouse.up()
        await pg.wait_for_timeout(500)
        out["right_2px"] = st

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
