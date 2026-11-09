import asyncio, json
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
  /* Ctrl+C 清空当前输入行（只清屏不清 buf 会把上一条留在里面） */
  t.worker.postMessage({t:'in', data:'\x03'});
  await sleep(250);
  t.term.clear();
  t.worker.postMessage({t:'in', data:'\x0c'});
  await sleep(250);
};
window.__type = async (s) => { __t().insert(s); await sleep(120); };
window.__tab = async () => { __t().worker.postMessage({t:'in', data:'\\t'}); await sleep(500); };
window.__enter = async () => { __t().worker.postMessage({t:'in', data:'\\r'}); await sleep(700); };
window.__buf = () => __t().buf;
"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1400, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(3000)
        await pg.wait_for_function("typeof TerminalManager !== 'undefined' && TerminalManager.desktop && TerminalManager.desktop.worker", timeout=25000)
        await pg.evaluate(HELP)
        await pg.wait_for_timeout(800)

        out = {}

        # 1 单个词 doc + Tab -> document
        out["doc_tab"] = await pg.evaluate("""async () => {
          await __clear();
          await __type('doc'); await __tab();
          return {line: __screen(3).split('\\n').pop(), buf: __t().buf};
        }""")

        # 2 document.quer + Tab
        out["member_tab"] = await pg.evaluate("""async () => {
          await __clear();
          await __type('document.quer'); await __tab();
          return {line: __screen(3).split('\\n').pop()};
        }""")

        # 3 document.q 连按两次 -> 列表
        out["list_tab"] = await pg.evaluate("""async () => {
          await __clear();
          await __type('document.q'); await __tab(); await __tab();
          return __screen(12);
        }""")

        # 4 Math. 空成员
        out["math_tab"] = await pg.evaluate("""async () => {
          await __clear();
          await __type('Math.'); await __tab();
          return __screen(10);
        }""")

        # 5 路径补全只在路径式输入才出现
        out["path_tab"] = await pg.evaluate("""async () => {
          await __clear();
          await __type('./'); await __tab();
          return __screen(8);
        }""")

        # 6 api() 全表
        out["api_table"] = await pg.evaluate("""async () => {
          await __clear();
          await __type('api()'); await __enter();
          const rows = __screen(30).split('\\n');
          return {head: rows.slice(0, 14), total: rows.length};
        }""")

        out["errs"] = errs
        print(json.dumps(out, ensure_ascii=False, indent=1))
        await b.close()

asyncio.run(main())
