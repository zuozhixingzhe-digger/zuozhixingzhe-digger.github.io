import asyncio, json, re
from playwright.async_api import async_playwright
URL='file:///workspace/hterminal/index.html'

LINES = [
 "const __a = 1",
 "__a + 1",
 "class Foo { constructor(){ this.n = 2 } }",
 "new Foo().n",
 "const {a: __da, b: __db} = {a: 3, b: 4}",
 "__da + __db",
 "const __m1 = 5, __m2 = 6",
 "__m1 + __m2",
 "function __f(){ return 7 }",
 "__f()",
 "let [__x, __y] = [8, 9]",
 "__x + __y",
 "var __v = 10",
 "__v",
 "class Bar { static s = 11 }",
 "Bar.s",
 "const __obj = { p: { q: 12 } }",
 "__obj.p.q",
]

async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        ctx=await b.new_context(viewport={'width':1200,'height':800}, color_scheme='dark')
        pg=await ctx.new_page()
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(URL)
        await pg.wait_for_selector('#boot.gone', state='attached', timeout=60000)
        await pg.wait_for_timeout(600)
        await pg.evaluate("() => WindowManager.open({type:'shell', title:'probe'})")
        await pg.wait_for_timeout(1500)
        for ln in LINES:
            await pg.evaluate("""(s) => {
              const ks=[...WindowManager.windows.values()].filter(w=>w.type==='shell');
              ks[ks.length-1].content._post({t:'in', data:s + '\\r'});
            }""", ln)
            await pg.wait_for_timeout(320)
        buf = await pg.evaluate("""() => {
          const ks=[...WindowManager.windows.values()].filter(w=>w.type==='shell');
          return ks[ks.length-1].content.buf;
        }""")
        clean = re.sub(r'\x1b\[[0-9;?]*[A-Za-z]', '', buf)
        print(clean[-3500:])
        print('ERRS', errs[:3])
        await b.close()
asyncio.run(main())
