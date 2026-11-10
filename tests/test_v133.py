import asyncio, json, math
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8787/"

HELP = """
window.__t = () => TerminalManager.desktop;
window.__screen = (n=14) => {
  const t = __t().term, b = t.buffer.active;
  const rows = [];
  const end = b.baseY + b.cursorY;
  const from = Math.max(0, end - (n-1));
  for (let i = from; i <= end; i++) {
    const line = b.getLine(i);
    if (line) rows.push(line.translateToString(true));
  }
  return rows.join('\\n');
};
window.__clear = async () => {
  const t = __t();
  t.worker.postMessage({t:'in', data:'\\x03'});
  await sleep(250);
  t.term.clear();
  t.worker.postMessage({t:'in', data:'\\x0c'});
  await sleep(250);
};
window.__type = async (s) => { __t().insert(s); await sleep(220); };
window.__cur = () => {
  const t = __t().term, b = t.buffer.active;
  const l = b.getLine(b.baseY + b.cursorY);
  return l ? l.translateToString(true) : '';
};
window.__tab = async () => { __t().worker.postMessage({t:'in', data:'\\t'}); await sleep(450); };
"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append("pageerror:" + str(e)[:200]))
        pg.on("console", lambda m: errs.append("console:" + m.text[:200]) if m.type == "error" else None)
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function("typeof TerminalManager !== 'undefined' && TerminalManager.desktop && TerminalManager.desktop.worker", timeout=25000)
        await pg.evaluate(HELP)
        await pg.wait_for_timeout(900)
        out = {}

        # 0 页面加载后焦点在终端
        out["boot_focus"] = await pg.evaluate("""() => {
          const a = document.activeElement;
          return { tag: a && a.tagName, cls: a && a.className, inTerm: !!(a && a.closest && a.closest('.xterm')) };
        }""")

        # 1 Tab 循环：document.q -> 表 -> query -> querySelector -> querySelectorAll
        out["tab_cycle"] = await pg.evaluate("""async () => {
          await __clear();
          await __type('document.q'); await __tab();
          const a = __cur();
          await __tab();
          const b1 = __cur();
          await __tab();
          const b2 = __cur();
          await __tab();
          const b3 = __cur();
          await __tab();
          const b4 = __cur();
          return { t1: a, t2: b1, t3: b2, t4: b3, t5: b4 };
        }""")

        # 2 打开终端窗口不抢焦点
        out["term_nofocus"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'shell'});
          await sleep(900);
          const a = document.activeElement;
          const ok = { tag:a && a.tagName, cls:a && a.className, inTerm:!!(a && a.closest && a.closest('.xterm')) };
          return { id:w.id, active:ok };
        }""")

        # 3 双击标题条（标题文字中心，避开色点）最大化/还原
        def_wpos = """() => {
          const w = [...WindowManager.windows.values()].find(x => x.type==='shell');
          const t = w.el.querySelector('.win-title');
          const r = t.getBoundingClientRect();
          return { x: r.left + r.width/2, y: r.top + r.height/2 };
        }"""
        wpos = await pg.evaluate(def_wpos)
        await pg.mouse.dblclick(wpos["x"], wpos["y"])
        await pg.wait_for_timeout(700)
        out["dbl_max"] = await pg.evaluate("""() => {
          const w = [...WindowManager.windows.values()].find(x => x.type==='shell');
          return { mode:w.mode, w:Math.round(w.el.getBoundingClientRect().width) };
        }""")
        wpos = await pg.evaluate(def_wpos)
        await pg.mouse.dblclick(wpos["x"], wpos["y"])
        await pg.wait_for_timeout(700)
        out["dbl_back"] = await pg.evaluate("""() => {
          const w = [...WindowManager.windows.values()].find(x => x.type==='shell');
          return { mode:w.mode, w:Math.round(w.el.getBoundingClientRect().width) };
        }""")

        # 4 Ctrl+滚轮只缩放这一扇
        zoom = await pg.evaluate("""async () => {
          const ws = [...WindowManager.windows.values()].filter(x => x.type==='shell');
          const a = ws[0], b = ws[1] || null;
          return { id:a.id, f0:a.content.fontSize, other: b ? b.content.fontSize : null,
                   rect: (() => { const r=a.el.getBoundingClientRect(); return {x:r.left+120,y:r.top+80}; })() };
        }""")
        await pg.mouse.move(zoom["rect"]["x"], zoom["rect"]["y"])
        await pg.keyboard.down("Control")
        for _ in range(3):
            await pg.mouse.wheel(0, -120)
            await pg.wait_for_timeout(80)
        await pg.keyboard.up("Control")
        await pg.wait_for_timeout(300)
        out["zoom"] = await pg.evaluate("""() => {
          const ws = [...WindowManager.windows.values()].filter(x => x.type==='shell');
          return { sizes: ws.map(x => x.content.fontSize), pageZoom: window.devicePixelRatio };
        }""")

        # 5 吸附：指针贴边才吸
        # 5a 窗口左缘贴边但指针在窗口中间 -> 不吸
        drag = await pg.evaluate("""() => {
          const w = [...WindowManager.windows.values()].find(x => x.type==='shell' && !x.maximized);
          w.el.style.left = '2px'; w.el.style.top = '120px';
          const r = w.el.getBoundingClientRect();
          const h = w.el.querySelector('.win-bar').getBoundingClientRect();
          return { id:w.id, x: r.left + r.width/2, y: h.top + h.height/2 };
        }""")
        await pg.mouse.move(drag["x"], drag["y"])
        await pg.mouse.down()
        for i in range(6):
            await pg.mouse.move(drag["x"] - i * 4, drag["y"] + i * 2)
            await pg.wait_for_timeout(20)
        out["snap_mid"] = await pg.evaluate("""() => {
          const el = document.getElementById('winSnap');
          return { shown: getComputedStyle(el).display !== 'none', pos: el.dataset.pos || null };
        }""")
        # 5b 指针拖到左边缘 2px -> 吸左
        await pg.mouse.move(4, drag["y"] + 40)
        await pg.wait_for_timeout(120)
        out["snap_edge"] = await pg.evaluate("""() => {
          const el = document.getElementById('winSnap');
          return { shown: getComputedStyle(el).display !== 'none', pos: el.dataset.pos || null };
        }""")
        await pg.mouse.up()
        await pg.wait_for_timeout(500)
        out["snap_after"] = await pg.evaluate("""() => {
          const w = [...WindowManager.windows.values()].find(x => x.type==='shell');
          return { left: Math.round(w.el.getBoundingClientRect().left), w: Math.round(w.el.getBoundingClientRect().width), snap: w.snapPos || null };
        }""")

        # 6 计算器：按下即响应
        await pg.evaluate("""async () => {
          for (const w of [...WindowManager.windows.values()]) if (w.type!=='shell') WindowManager.close(w.id);
          window.__cw = WindowManager.open({type:'calc'});
          await sleep(700);
          __cw.content.expr = ''; __cw.content.res='0'; __cw.content.render();
        }""")
        cbox = await pg.evaluate("""() => {
          const q = (s) => { const r = __cw.el.querySelector(s).getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; };
          return { one:q('[data-ins="1"]'), plus:q('[data-ins="+"]'), two:q('[data-ins="2"]'), eq:q('[data-act="eq"]') };
        }""")
        await pg.mouse.move(*cbox["one"]); await pg.mouse.down(); await pg.mouse.up()
        await pg.wait_for_timeout(12)
        out["calc_immediate"] = await pg.evaluate("() => ({ expr: __cw.content.expr })")
        for k in ("plus", "two"):
            await pg.mouse.click(*cbox[k], delay=0)
            await pg.wait_for_timeout(25)
        await pg.mouse.click(*cbox["eq"], delay=0)
        await pg.wait_for_timeout(300)
        out["calc_eq"] = await pg.evaluate("() => ({ expr: __cw.content.expr, res: __cw.content.res })")

        # 7 抽屉：短促快扫也能关
        await pg.evaluate("""async () => { for (const w of [...WindowManager.windows.values()]) if (w.type!=='shell') WindowManager.close(w.id); await sleep(250);
          document.querySelector('[data-act="more"]').click(); await sleep(650); }""")
        dpos = await pg.evaluate("""() => {
          const d = document.getElementById('drawer'), r = d.getBoundingClientRect();
          return { x: r.left + 60, y: r.top + 240, opened: d.classList.contains('on') };
        }""")
        await pg.mouse.move(dpos["x"], dpos["y"])
        await pg.mouse.down()
        for i in range(1, 5):
            await pg.mouse.move(dpos["x"] + i * 14, dpos["y"] + 1)
            await pg.wait_for_timeout(10)
        await pg.mouse.up()
        await pg.wait_for_timeout(500)
        out["drawer_short"] = await pg.evaluate("""() => {
          const d = document.getElementById('drawer');
          return { opened: d.classList.contains('on'), left: Math.round(d.getBoundingClientRect().left) };
        }""")

        out["errs"] = errs[:8]
        print(json.dumps(out, ensure_ascii=False, indent=1))
        await b.close()


asyncio.run(main())
