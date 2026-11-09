import asyncio, json
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8787/"

async def main():
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1400, "height": 900})
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
        await pg.goto(URL, wait_until="load")
        await pg.wait_for_timeout(2500)

        out = {}

        # 1 双击标题 -> 常规最大化
        out["dblclick_max"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'editor', content:'x'});
          await sleep(300);
          const h = document.querySelector('.win[data-id="'+w.id+'"] .win-bar');
          const r = h.getBoundingClientRect();
          /* 点标题区中间，避开左右两端的色点 */
          h.dispatchEvent(new MouseEvent('dblclick', {bubbles:true, detail:2,
            clientX: r.x + r.width/2, clientY: r.y + r.height/2}));
          await sleep(450);
          const el = document.querySelector('.win[data-id="'+w.id+'"]');
          const res = {mode: w.mode, width: Math.round(el.getBoundingClientRect().width)};
          WindowManager.close(w.id);
          return res;
        }""")

        # 2 长按红点 -> 四圆钮、零文字
        out["longpress_dot"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'editor', content:'y'});
          await sleep(350);
          const dot = document.querySelector('.win[data-id="'+w.id+'"] .win-dot.x');
          const r = dot.getBoundingClientRect();
          dot.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId:1, clientX:r.x+5, clientY:r.y+5}));
          await sleep(750);
          const m = document.querySelector('.dotmenu');
          const res = m ? {n: m.querySelectorAll('button').length, txt: m.textContent.trim()} : {n:0, txt:'none'};
          DotMenu.close();
          WindowManager.close(w.id);
          return res;
        }""")

        # 3 隐藏式胶囊：纯图标、独占
        out["hidden_chip"] = await pg.evaluate("""async () => {
          const a = WindowManager.open({type:'editor', content:'a'});
          const b2 = WindowManager.open({type:'editor', content:'b'});
          await sleep(300);
          WindowManager.maxMode(a.id, 'hidden');
          await sleep(250);
          const chip = document.getElementById('hidChip');
          const mid = {on: !chip.hidden, txt: chip.textContent.trim(),
                       w: Math.round(chip.getBoundingClientRect().width),
                       title: chip.getAttribute('title'), svg: !!chip.querySelector('svg')};
          WindowManager.maxMode(b2.id, 'hidden');
          await sleep(250);
          const res = {first: mid, aMode: a.mode, bMode: b2.mode};
          WindowManager.close(a.id); WindowManager.close(b2.id);
          return res;
        }""")

        # 4 彻底全屏：body.immersive + 顶栏全屏键点亮 + 悬浮球
        out["immersive"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'editor', content:'c'});
          await sleep(300);
          WindowManager.maxMode(w.id, 'immersive');
          await sleep(600);
          const fb = document.querySelector('[data-act="fullscreen"]');
          const res = {body: document.body.classList.contains('immersive'),
                       fsBtn: !!(fb && fb.classList.contains('k--active')),
                       ball: !!document.getElementById('imBall')};
          WindowManager.close(w.id);
          await sleep(300);
          res.after = document.body.classList.contains('immersive');
          return res;
        }""")

        # 5 守护：坏参数拉回画布内
        out["guard"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'editor', content:'g'});
          await sleep(300);
          const el = document.querySelector('.win[data-id="'+w.id+'"]');
          el.style.width='40px'; el.style.height='30px'; el.style.left='5000px'; el.style.top='-200px';
          w.width=40; w.height=30; w.x=5000; w.y=-200;
          Guard.check(true);
          await sleep(500);
          const r = el.getBoundingClientRect();
          /* 设计允许半出界，红线是「至少 90px 留在画布内」 */
          const visX = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
          const visY = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
          const res = {w: Math.round(r.width), h: Math.round(r.height),
                       visX: Math.round(visX), visY: Math.round(visY), ok: visX >= 88 && visY > 0,
                       guardUntil: !!w._guardUntil};
          WindowManager.close(w.id);
          return res;
        }""")

        # 6 时间戳四格全可填、联动
        out["data_ts"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'data'}); await sleep(450);
          const sec = document.querySelector('[data-f="sec"]');
          sec.value = '1700000000';
          sec.dispatchEvent(new Event('input', {bubbles:true}));
          await sleep(200);
          const res = {ms: document.querySelector('[data-f="ms"]').value,
                       dt: document.querySelector('[data-f="dt"]').value,
                       fillable: [...document.querySelectorAll('.tl-body input')].filter(i=>!i.readOnly && !i.disabled).length,
                       tabs: document.querySelectorAll('.tl-tab').length,
                       nowBtn: !!document.querySelector('[data-a="now"]')};
          WindowManager.close(w.id);
          return res;
        }""")

        # 7 计时器：秒表跑起来 + 计次
        out["timer"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'timer'}); await sleep(450);
          document.querySelector('[data-a="swGo"]').click();
          await sleep(1400);
          document.querySelector('[data-a="swLap"]').click();
          await sleep(200);
          const face = document.querySelector('[data-f="swTime"]').textContent.trim();
          const laps = document.querySelectorAll('.tm-lap').length;
          document.querySelector('[data-a="swReset"]').click();
          await sleep(120);
          const reset = document.querySelector('[data-f="swTime"]').textContent.trim();
          /* 倒计时：5 分快捷 → 开始 → 读数下降 */
          document.querySelector('[data-t="down"]').click();
          await sleep(120);
          document.querySelector('[data-min="300"]').click();
          await sleep(120);
          const cd0 = document.querySelector('[data-f="cdTime"]').textContent.trim();
          document.querySelector('[data-a="cdGo"]').click();
          await sleep(1300);
          const cd1 = document.querySelector('[data-f="cdTime"]').textContent.trim();
          WindowManager.close(w.id);
          return {face, laps, reset, cd0, cd1};
        }""")

        # 8 所有应用：分组 + 双视图
        out["applist"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'applist'}); await sleep(700);
          const heads = [...document.querySelectorAll('.al-sec')].map(e=>e.textContent.trim());
          const gridCards = document.querySelectorAll('.al-card').length;
          const grid = w.content.view;
          document.querySelector('[data-v="list"]')?.click();
          await sleep(250);
          const listRows = document.querySelectorAll('.al-row').length;
          const res = {heads, grid, gridCards, after: w.content.view, listRows};
          WindowManager.close(w.id);
          return res;
        }""")

        # 9 汉字码：汉字侧识别出方案 → 顶部选项卡跟随
        out["hanzi"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'hanzi'}); await sleep(500);
          const a = w.content;
          /* 左边输入 hex，右边按 B 方案生成带标记字的密文 */
          a.hexEl.value = '48656c6c6f';
          a.hexEl.dispatchEvent(new Event('input', {bubbles:true}));
          await sleep(300);
          document.querySelector('.hz-seg [data-s="B"]').click();
          await sleep(400);
          const cipher = a.hanEl.value;
          /* 再切回 A，把 B 的密文粘进汉字栏——应该自己认出 B 并还原 hex */
          document.querySelector('.hz-seg [data-s="A"]').click();
          await sleep(300);
          a.hanEl.value = cipher;
          a.hanEl.dispatchEvent(new Event('input', {bubbles:true}));
          await sleep(600);
          const on = [...document.querySelectorAll('.hz-seg [data-s]')].find(x=>x.classList.contains('on'))?.dataset.s;
          const res = {cipher, hex: a.hexEl.value, tab: on, foot: !!document.querySelector('.hz-foot')};
          WindowManager.close(w.id);
          return res;
        }""")

        # 10 HSV 选区不镜像
        out["hsv"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'color'}); await sleep(500);
          document.querySelector('[data-viz="hsv"]').click();
          await sleep(250);
          const pad = document.querySelector('[data-f="sv"]');
          const dot = document.querySelector('[data-f="svdot"]');
          const r = pad.getBoundingClientRect();
          const pick = async (fy) => {
            pad.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, pointerId:2,
              clientX: r.x + r.width/2, clientY: r.y + r.height*fy}));
            await sleep(200);
            return Math.round((dot.getBoundingClientRect().top - r.top) / r.height * 100);
          };
          const top = await pick(0.05), bot = await pick(0.95);
          WindowManager.close(w.id);
          return {dotTopPct: top, dotBottomPct: bot};
        }""")

        # 11 截图隐藏窗口 + 计时器入口
        out["shot"] = await pg.evaluate("""async () => {
          const w = WindowManager.open({type:'shot'}); await sleep(450);
          const res = {chk: !!document.querySelector('[data-f="hide"]'),
                       label: document.querySelector('[data-f="hide"]')?.parentElement?.textContent.trim(),
                       desc: (APP_DESC.timer||'').slice(0,10)};
          WindowManager.close(w.id);
          return res;
        }""")

        # 12 .app 目录
        out["appdir"] = await pg.evaluate("""async () => {
          const items = (await FS.list('.app')) || [];
          const map = {};
          items.forEach(i => { const k = i.kind || 'file'; map[k] = (map[k]||0)+1; });
          let binAlive = false;
          try { const l = await FS.list('.bin'); binAlive = Array.isArray(l) && l.length > 0; } catch (e) { binAlive = false; }
          return {total: items.length, kinds: map, binAlive};
        }""")

        out["errs"] = errs
        print(json.dumps(out, ensure_ascii=False, indent=1))
        await b.close()

asyncio.run(main())
