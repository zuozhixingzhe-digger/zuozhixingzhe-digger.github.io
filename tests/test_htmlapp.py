import asyncio, json
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8787/"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.on("console", lambda m: errs.append("console:" + m.text[:160]) if m.type == "error" else None)
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function("typeof TerminalManager !== 'undefined' && TerminalManager.desktop", timeout=25000)
        await pg.wait_for_timeout(800)
        out = {}

        # 打开编辑器，清空成小文档
        await pg.evaluate("""async () => {
          for (const w of [...WindowManager.windows.values()]) if (w.type !== 'shell') WindowManager.close(w.id);
          await sleep(300);
          window.__w = WindowManager.open({type:'htmlapp'});
          await sleep(900);
          const a = __w.content;
          a._setText('<h1 id="t">A</h1>\\n<button id="b">go</button>', 0);
          await sleep(500);
        }""")

        # 1 鼠标点第二行 -> 光标落在该行
        box = await pg.evaluate("""() => {
          const r = __w.content.cv.getBoundingClientRect();
          return {x: r.x, y: r.y, w: r.width, h: r.height};
        }""")
        # 第二行 y = top + 6 + 1.5*lineH
        lh = await pg.evaluate("() => __w.content.lh")
        await pg.mouse.click(box["x"] + 90, box["y"] + 6 + lh * 1.4)
        await pg.wait_for_timeout(300)
        out["click"] = await pg.evaluate("""() => {
          const a = __w.content, p = a._pos(a.caret);
          return {row: p.row, col: p.col, focused: document.activeElement === a.ta};
        }""")

        # 2 键入字符 -> 文本变化 + 预览更新
        await pg.keyboard.type("X", delay=40)
        await pg.wait_for_timeout(900)
        out["type"] = await pg.evaluate("""() => ({
          tail: __w.content.text.slice(0, 40),
          hasX: __w.content.text.includes('X'),
          run: __w.content.fRun.textContent
        })""")

        # 3 Tab 缩进
        await pg.keyboard.press("Tab")
        await pg.wait_for_timeout(300)
        out["tab"] = await pg.evaluate("""() => ({
          len: __w.content.text.length,
          line2: __w.content._lines()[1].text
        })""")

        # 4 撤销
        await pg.keyboard.press("Control+z")
        await pg.wait_for_timeout(300)
        out["undo"] = await pg.evaluate("""() => ({
          len: __w.content.text.length,
          line2: __w.content._lines()[1].text
        })""")

        # 5 实时渲染：改内容 -> iframe 里真的有
        await pg.evaluate("""async () => {
          const a = __w.content;
          a._setText('<h1 id="t">HELLO-RENDER</h1>', 0);
          await sleep(900);
        }""")
        out["live"] = await pg.evaluate("""() => {
          const d = __w.content.frame.contentDocument;
          return {title: d && d.getElementById('t') ? d.getElementById('t').textContent : null,
                  srcdocLen: __w.content.frame.srcdoc.length};
        }""")

        # 6 脚本能跑（老实渲染）
        await pg.evaluate("""async () => {
          const a = __w.content;
          a._setText('<div id="o">-</div><script>document.getElementById("o").textContent = "RAN";<\\/script>', 0);
          await sleep(900);
        }""")
        out["script"] = await pg.evaluate("""() => {
          const d = __w.content.frame.contentDocument;
          return d && d.getElementById('o') ? d.getElementById('o').textContent : null;
        }""")

        # 7 保存（走真实 UI：点按钮 -> 弹框 -> 填名字 -> 确认）
        await pg.evaluate("""async () => {
          const a = __w.content;
          a.text = '<p id="s">saved</p>';
          a._path = null;
          a._setText(a.text, 0);
        }""")
        await pg.click('.hx-bar [data-a="save"]')
        await pg.wait_for_timeout(400)
        await pg.fill('#mpIn', 'hx-test.html')
        await pg.wait_for_timeout(150)
        await pg.click('.dlg-orb.ok')
        await pg.wait_for_timeout(700)
        out["save"] = await pg.evaluate("""async () => {
          const p = __w.content._path;
          const rd = p ? await FS.read(p) : null;
          return {found: !!rd, name: p && p.split('.').pop(),
                  shown: p ? spotExportName(p) : null,
                  content: rd && String(rd.content || '').slice(0, 40)};
        }""")

        # 8 视图切换（只看预览 / 只看编辑）
        out["view"] = await pg.evaluate("""async () => {
          const a = __w.content;
          a.split = 1; a._layout(); a._layoutFrame();
          const onlyEdit = {prev: a.prevBox.style.display, edit: a.editBox.style.display};
          a.split = 0; a._layout(); a._layoutFrame();
          const onlyPrev = {prev: a.prevBox.style.display, edit: a.editBox.style.display};
          a.split = 0.5; a._layout(); a._layoutFrame();
          return {onlyEdit, onlyPrev};
        }""")

        # 9 窄窗口 -> 上下分栏
        out["narrow"] = await pg.evaluate("""async () => {
          const a = __w.content;
          __w.el.style.width = '420px';
          a._layout();
          await sleep(200);
          return {vertical: a._vertical, rows: a.bodyEl.style.gridTemplateRows};
        }""")

        out["errs"] = errs
        print(json.dumps(out, ensure_ascii=False, indent=1))
        await b.close()

asyncio.run(main())
