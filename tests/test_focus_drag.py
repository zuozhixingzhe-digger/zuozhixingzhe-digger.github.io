import asyncio, json, math
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8787/"

PROBE = """
() => {
  window.__frame = { d: [], long: [], on: true };
  let last = performance.now();
  const tick = (t) => {
    if (!window.__frame.on) return;
    if (t - last < 2000) window.__frame.d.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__frame.long.push(e.duration);
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) {}
}
"""

REPORT = """
() => {
  window.__frame.on = false;
  const d = window.__frame.d.slice().sort((a, b) => a - b);
  const L = window.__frame.long.slice();
  const q = (p) => d.length ? Math.round(d[Math.min(d.length - 1, Math.floor(d.length * p))] * 10) / 10 : 0;
  return { n: d.length, p50: q(0.5), p95: q(0.95), max: d.length ? Math.round(d[d.length-1]*10)/10 : 0,
           over33: d.filter(x => x > 33.4).length, longN: L.length, longMax: L.length ? Math.round(Math.max.apply(null, L)) : 0 };
}
"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1440, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_function("typeof TerminalManager !== 'undefined' && TerminalManager.desktop", timeout=25000)
        await pg.wait_for_timeout(1000)
        out = {}

        # 焦点：逐个开应用，看 activeElement 是否落进新窗口
        out["focus"] = []
        for t in ["browser", "files", "editor", "agent", "image", "htmlapp", "color", "data"]:
            rec = await pg.evaluate("""async (t) => {
              for (const w of [...WindowManager.windows.values()]) if (w.type !== 'shell') WindowManager.close(w.id);
              await sleep(220);
              const w = WindowManager.open({type:t});
              await sleep(750);
              const a = document.activeElement;
              const info = { t, tag: a && a.tagName, cls: (a && a.className && String(a.className).slice(0,40)) || '',
                             inside: !!(a && a.closest && a.closest('.win')) };
              WindowManager.close(w.id);
              await sleep(160);
              return info;
            }""", t)
            out["focus"].append(rec)

        # 拖动：transform 生效、left/top 不动、帧间隔
        await pg.evaluate("""async () => {
          for (const w of [...WindowManager.windows.values()]) if (w.type !== 'shell') WindowManager.close(w.id);
          window.__w = WindowManager.open({type:'shell'});
          await sleep(900);
        }""")
        pos = await pg.evaluate("""() => {
          const r = __w.el.getBoundingClientRect();
          const b = __w.el.querySelector('.win-bar').getBoundingClientRect();
          __w.el.style.left = '200px'; __w.el.style.top = '100px';
          return { x: r.left + r.width/2, y: b.top + b.height/2 };
        }""")
        await pg.evaluate(PROBE)
        await pg.mouse.move(pos["x"], pos["y"])
        await pg.mouse.down()
        mid = None
        for i in range(45):
            await pg.mouse.move(pos["x"] + math.sin(i / 5) * 200, pos["y"] + math.cos(i / 6) * 120)
            await pg.wait_for_timeout(16)
            if i == 20:
                mid = await pg.evaluate("""() => ({ left: __w.el.style.left, top: __w.el.style.top,
                                                   tr: __w.el.style.transform, cls: __w.el.className })""")
        await pg.mouse.up()
        await pg.wait_for_timeout(300)
        out["drag_mid"] = mid
        out["drag_end"] = await pg.evaluate("""() => ({ left: __w.el.style.left, top: __w.el.style.top,
                                                       tr: __w.el.style.transform })""")
        out["drag_perf"] = await pg.evaluate(REPORT)

        # 缩放性能 + 打字
        box = await pg.evaluate("""() => {
          const r = __w.el.getBoundingClientRect();
          return { x: r.left + 160, y: r.top + 120 };
        }""")
        await pg.mouse.move(box["x"], box["y"])
        await pg.evaluate(PROBE)
        await pg.keyboard.down("Control")
        for _ in range(6):
            await pg.mouse.wheel(0, -120)
            await pg.wait_for_timeout(60)
        for _ in range(4):
            await pg.mouse.wheel(0, 120)
            await pg.wait_for_timeout(60)
        await pg.keyboard.up("Control")
        for i in range(40):
            await pg.keyboard.type("abcdefghij"[i % 10])
            await pg.wait_for_timeout(18)
        out["zoom_perf"] = await pg.evaluate(REPORT)
        out["font"] = await pg.evaluate("() => __w.content.fontSize")

        out["errs"] = errs[:6]
        print(json.dumps(out, ensure_ascii=False, indent=1))
        await b.close()


asyncio.run(main())
