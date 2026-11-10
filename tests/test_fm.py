"""文件管理器：双击自动判断、工具栏「编辑 / 执行」的回归测试（0.0.1.34 起「打开」改名「编辑」）。"""
import asyncio, json
from playwright.async_api import async_playwright

URL = 'file:///workspace/hterminal/index.html'
JS = "console.log('run-ok', 6*7);\nlet s=0; for (let i=1;i<=10;i++) s+=i; console.log('sum', s);\n"
HTML = "<!doctype html><meta charset=utf-8><title>t</title><h1 id=x>hello-html</h1>"


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1280, 'height': 820}, color_scheme='dark')
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGE ' + str(e)))
        pg.on('console', lambda m: errs.append('C:' + m.text) if m.type == 'error' else None)
        await pg.goto(URL)
        await pg.wait_for_selector('#boot.gone', state='attached', timeout=60000)
        await pg.wait_for_timeout(500)

        await pg.evaluate("""async ([js, html]) => {
            await FS.write('.home.run-test-js', js, { mime:'text/javascript', kind:'object' });
            await FS.write('.home.page-test-html', html, { mime:'text/html', kind:'object' });
            WindowManager.open({ type:'files', path:'.home', title:'文件' });
        }""", [JS, HTML])
        await pg.wait_for_timeout(800)

        async def focus_files():
            await pg.evaluate("""() => {
                const w=[...WindowManager.windows.values()].find(x=>x.type==='files');
                if (w) WindowManager.focus(w.id);
            }""")
            await pg.wait_for_timeout(200)

        async def click_row(name, button):
            await focus_files()
            box = await pg.evaluate("""(name) => {
                const r = [...document.querySelectorAll('.fm-row')].find(x => x.querySelector('.nm').textContent.startsWith(name));
                if (!r) return null;
                r.scrollIntoView({block:'center'});
                return r.getBoundingClientRect().toJSON();
            }""", name)
            if not box:
                print('row not found', name); return False
            await pg.mouse.click(box['x'] + 50, box['y'] + box['height'] / 2)
            await pg.wait_for_timeout(250)
            await pg.click(f'.fm [data-a="{button}"]')
            await pg.wait_for_timeout(1200)
            return True

        # 执行 JS
        await click_row('run-test-js', 'run')
        info = await pg.evaluate("""() => {
            const ws=[...WindowManager.windows.values()];
            const w=ws[ws.length-1];
            return {types:ws.map(x=>x.type), title:w.title, text:(w.body.innerText||'').slice(0,300)};
        }""")
        print('run js', json.dumps(info, ensure_ascii=False))
        await pg.screenshot(path='/workspace/fm-run-js.png')

        # 执行 HTML
        await click_row('page-test-html', 'run')
        info = await pg.evaluate("""() => {
            const ws=[...WindowManager.windows.values()];
            const w=ws[ws.length-1];
            const f=w.body.querySelector('iframe');
            return {types:ws.map(x=>x.type), title:w.title, srcdoc:(f&&f.srcdoc||'').length};
        }""")
        print('run html', json.dumps(info, ensure_ascii=False))
        await pg.screenshot(path='/workspace/fm-run-html.png')

        # 编辑 JS（应进编辑器）
        await click_row('run-test-js', 'edit')
        info = await pg.evaluate("""() => {
            const ws=[...WindowManager.windows.values()];
            const w=ws[ws.length-1];
            return {type:w.type, hasArea:!!w.body.querySelector('textarea'),
                    val:(w.body.querySelector('textarea')||{}).value?.slice(0,40)};
        }""")
        print('edit js', json.dumps(info, ensure_ascii=False))

        # 双击（鼠标真双击）
        n0 = await pg.evaluate("() => WindowManager.windows.size")
        box = await pg.evaluate("""() => {
            const r = [...document.querySelectorAll('.fm-row')].find(x => x.querySelector('.nm').textContent.startsWith('page-test'));
            return r && r.getBoundingClientRect().toJSON();
        }""")
        await pg.mouse.dblclick(box['x'] + 50, box['y'] + box['height'] / 2)
        await pg.wait_for_timeout(900)
        n1 = await pg.evaluate("() => WindowManager.windows.size")
        print('dblclick windows', n0, '->', n1)

        print('ERRS', json.dumps(errs[:10], ensure_ascii=False))
        await b.close()

asyncio.run(main())
