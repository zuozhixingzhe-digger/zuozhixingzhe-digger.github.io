import asyncio, json
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8787/"


async def longpress(pg, x, y, ms=700):
    await pg.mouse.move(x, y)
    await pg.mouse.down()
    await pg.wait_for_timeout(ms)
    await pg.mouse.up()
    await pg.wait_for_timeout(180)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1400, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror:" + str(e)[:200]))
        pg.on("console", lambda m: errs.append("console:" + m.text[:200]) if m.type == "error" else None)
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function("typeof TerminalManager !== 'undefined' && TerminalManager.desktop", timeout=25000)
        await pg.wait_for_timeout(1000)
        out = {}

        # 开一扇窗口（用计算器，尺寸稳定）
        info = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'calc'});
          await sleep(900);
          const d = w.el.querySelector('.win-dot[data-a="max"]').getBoundingClientRect();
          return { id:w.id, dot:[d.left+d.width/2, d.top+d.height/2] };
        }""")

        # 1 窗口色点长按 -> 四钮框
        await longpress(pg, *info["dot"])
        out["lv1_from_dot"] = await pg.evaluate("""() => {
          const m = document.querySelector('.dotmenu');
          return { open: !!m, n: m ? m.querySelectorAll('[data-a]').length : 0 };
        }""")

        # 2 四钮框里的「绿」再长按 -> 二级菜单
        green = await pg.evaluate("""() => {
          const b = document.querySelector('.dotmenu [data-a="max"]').getBoundingClientRect();
          return [b.left + b.width/2, b.top + b.height/2];
        }""")
        await longpress(pg, *green)
        out["lv2_from_dotmenu"] = await pg.evaluate("""() => {
          const m = document.querySelector('.winmenu');
          return { open: !!m, title: m ? m.querySelector('.winmenu__title').textContent : null,
                   dotmenuGone: !document.querySelector('.dotmenu'),
                   items: m ? [...m.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g,' ').trim()).slice(0,4) : [] };
        }""")
        await pg.keyboard.press("Escape")
        await pg.wait_for_timeout(200)

        # 3 隐藏式最大化 -> 顶栏胶囊长按 -> 四钮框 -> 长按黄钮 -> 二级
        chip = await pg.evaluate("""async (id) => {
          WindowManager.maxMode(id, 'hidden');
          await sleep(700);
          const c = document.getElementById('hidChip');
          const r = c.getBoundingClientRect();
          return { on: c.classList.contains('on'), x: r.left + r.width/2, y: r.top + r.height/2 };
        }""", info["id"])
        out["chip_on"] = chip["on"]
        await longpress(pg, chip["x"], chip["y"])
        out["lv1_from_chip"] = await pg.evaluate("""() => {
          const m = document.querySelector('.dotmenu');
          return { open: !!m, n: m ? m.querySelectorAll('[data-a]').length : 0 };
        }""")
        yellow = await pg.evaluate("""() => {
          const b = document.querySelector('.dotmenu [data-a="min"]').getBoundingClientRect();
          return [b.left + b.width/2, b.top + b.height/2];
        }""")
        await longpress(pg, *yellow)
        out["lv2_from_chip"] = await pg.evaluate("""() => {
          const m = document.querySelector('.winmenu');
          return { open: !!m, title: m ? m.querySelector('.winmenu__title').textContent : null,
                   items: m ? [...m.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g,' ').trim()) : [] };
        }""")
        await pg.keyboard.press("Escape")
        await pg.evaluate("""async (id) => { WindowManager.maxMode(id, 'normal'); await sleep(500); }""", info["id"])

        # 4 Dock 图标长按 -> 四钮框 -> 蓝钮长按 -> 二级
        dock = await pg.evaluate("""(id) => {
          const b = document.querySelector(`#dock [data-win="${id}"]`);
          const r = b.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2 };
        }""", info["id"])
        await longpress(pg, dock["x"], dock["y"])
        out["lv1_from_dock"] = await pg.evaluate("""() => {
          const m = document.querySelector('.dotmenu');
          return { open: !!m, n: m ? m.querySelectorAll('[data-a]').length : 0 };
        }""")
        blue = await pg.evaluate("""() => {
          const b = document.querySelector('.dotmenu [data-a="back"]').getBoundingClientRect();
          return [b.left + b.width/2, b.top + b.height/2];
        }""")
        await longpress(pg, *blue)
        out["lv2_from_dock"] = await pg.evaluate("""() => {
          const m = document.querySelector('.winmenu');
          return { open: !!m, title: m ? m.querySelector('.winmenu__title').textContent : null,
                   items: m ? [...m.querySelectorAll('button')].map(b => b.textContent.replace(/\\s+/g,' ').trim()) : [] };
        }""")

        # 5 单扇窗口缩放互不影响
        out["zoom_scope"] = await pg.evaluate("""async () => {
          WindowManager.close(WindowManager.focused().id);
          await sleep(300);
          const a = WindowManager.open({type:'shell'});
          const b = WindowManager.open({type:'shell'});
          await sleep(900);
          a.content.fontSize = 14; b.content.fontSize = 14;
          a.content.term.options.fontSize = 14; b.content.term.options.fontSize = 14;
          a.content.fit.fit(); b.content.fit.fit();
          return { a: a.content.fontSize, b: b.content.fontSize, ids:[a.id, b.id] };
        }""")
        z = await pg.evaluate("""() => {
          const ws = [...WindowManager.windows.values()].filter(x => x.type === 'shell');
          const r = ws[0].content.container.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2 };
        }""")
        await pg.mouse.move(z["x"], z["y"])
        await pg.keyboard.down("Control")
        await pg.mouse.wheel(0, -120)
        await pg.wait_for_timeout(120)
        await pg.keyboard.up("Control")
        await pg.wait_for_timeout(300)
        out["zoom_scope_after"] = await pg.evaluate("""() => {
          const ws = [...WindowManager.windows.values()].filter(x => x.type === 'shell');
          return ws.map(x => x.content.fontSize);
        }""")

        out["errs"] = errs[:8]
        print(json.dumps(out, ensure_ascii=False, indent=1))
        await b.close()


asyncio.run(main())
