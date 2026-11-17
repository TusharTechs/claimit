// Records real browsers driving the live app: one Chromium per "actor" (seller laptop, buyer phones, operator),
// each captured through the DevTools screencast at device resolution, with wall-clock timestamps per frame so
// every actor's footage shares one timeline.
import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export interface Mark { name: string; t: number; data?: unknown }
export const marks: Mark[] = [];
export const mark = (name: string, data?: unknown) => { marks.push({ name, t: Date.now(), data }); console.log(`  · ${name}`); };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A visible pointer + tap ripple, so viewers can follow what is being pressed in a headless recording. */
const POINTER = `(() => {
  if (window.__ptr) return; window.__ptr = true;
  const css = document.createElement('style');
  css.textContent = '#__ptr{position:fixed;z-index:2147483647;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(23,18,14,.28);border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.25);pointer-events:none;opacity:0;transition:opacity .25s, transform .12s;transform:translate(-100px,-100px)}'
    + '#__ptr.down{background:rgba(255,74,28,.55);}'
    + '.__rip{position:fixed;z-index:2147483646;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid rgba(255,74,28,.9);pointer-events:none;animation:__rip .55s ease-out forwards}'
    + '@keyframes __rip{to{transform:scale(5);opacity:0}}';
  const add = () => {
    document.head.appendChild(css);
    const d = document.createElement('div'); d.id = '__ptr'; document.body.appendChild(d);
    let hide;
    const show = (x, y) => { d.style.opacity = '1'; d.style.transform = 'translate(' + x + 'px,' + y + 'px)'; clearTimeout(hide); hide = setTimeout(() => { d.style.opacity = '0'; }, 2200); };
    window.addEventListener('mousemove', (e) => show(e.clientX, e.clientY), true);
    window.addEventListener('mousedown', (e) => { show(e.clientX, e.clientY); d.classList.add('down');
      const r = document.createElement('div'); r.className = '__rip'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); }, true);
    window.addEventListener('mouseup', () => d.classList.remove('down'), true);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();`;

export interface ActorOpts { width: number; height: number; dsf?: number; mobile?: boolean; trace?: boolean }

export class Actor {
  page!: Page;
  private browser!: Browser;
  private ctx!: BrowserContext;
  private cdp!: CDPSession;
  private n = 0;
  private index: { n: number; t: number }[] = [];
  private pending: Promise<unknown>[] = [];
  private mouse = { x: 0, y: 0 };
  traceLog: { t: number; kind: string; [k: string]: unknown }[] = [];
  readonly dir: string;

  constructor(readonly name: string, runDir: string, readonly opts: ActorOpts) {
    this.dir = path.join(runDir, name);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  static async launch(name: string, runDir: string, opts: ActorOpts) {
    const a = new Actor(name, runDir, opts);
    // Full Chromium in headless mode captures at device pixels; the window must match the emulated viewport.
    a.browser = await chromium.launch({ channel: 'chromium', args: [`--window-size=${opts.width},${opts.height}`, '--hide-scrollbars'] });
    a.ctx = await a.browser.newContext({
      viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: opts.dsf ?? 2,
      isMobile: !!opts.mobile, hasTouch: false, locale: 'en-US', timezoneId: 'America/New_York',
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    await a.ctx.addInitScript(POINTER);
    if (opts.trace !== false) {
      // Every SDK event is forwarded here as it happens, so navigating to another page never loses the trace.
      await a.ctx.exposeBinding('__ncEmit', (_src, json: string) => { try { a.traceLog.push(JSON.parse(json)); } catch { /* ignore */ } });
      await a.ctx.addInitScript(() => {
        const log: unknown[] = [];
        const push = log.push.bind(log);
        log.push = (...e: unknown[]) => { for (const x of e) (window as unknown as { __ncEmit?: (j: string) => void }).__ncEmit?.(JSON.stringify(x)); return push(...e); };
        (window as unknown as { __ncTrace: unknown[] }).__ncTrace = log;
      });
    }
    a.page = await a.ctx.newPage();
    a.mouse = { x: opts.width / 2, y: opts.height * 0.6 };
    a.cdp = await a.ctx.newCDPSession(a.page);
    a.cdp.on('Page.screencastFrame', (f) => {
      const n = a.n++;
      a.index.push({ n, t: Math.round((f.metadata.timestamp ?? Date.now() / 1000) * 1000) });
      a.pending.push(fs.promises.writeFile(path.join(a.dir, `f${String(n).padStart(6, '0')}.jpg`), Buffer.from(f.data, 'base64')));
      a.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await a.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
    return a;
  }

  /** Move the pointer there like a person would, then press. */
  async click(target: Locator | string, o: { pause?: number; timeout?: number } = {}) {
    const loc = typeof target === 'string' ? this.page.locator(target).first() : target.first();
    await loc.waitFor({ state: 'visible', timeout: o.timeout ?? 20_000 });
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox();
    if (box) {
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const dist = Math.hypot(x - this.mouse.x, y - this.mouse.y);
      await this.page.mouse.move(x, y, { steps: Math.max(6, Math.min(28, Math.round(dist / 28))) });
      this.mouse = { x, y };
      await sleep(140);
      await this.page.mouse.down(); await sleep(70); await this.page.mouse.up();
    } else await loc.click();
    await sleep(o.pause ?? 350);
  }

  async type(target: Locator | string, text: string, o: { delay?: number; pause?: number } = {}) {
    const loc = typeof target === 'string' ? this.page.locator(target).first() : target.first();
    await this.click(loc, { pause: 150 });
    await this.page.keyboard.type(text, { delay: o.delay ?? 38 });
    await sleep(o.pause ?? 300);
  }

  text(t: string | RegExp, exact = false) { return this.page.getByText(t, { exact }); }
  button(name: string | RegExp) { return this.page.getByRole('button', { name }); }

  /** What the Nexconn SDK did in this page so far (see web/src/rt.ts `trace`). */
  async sdkTrace(): Promise<{ t: number; kind: string; [k: string]: unknown }[]> {
    return this.traceLog;
  }

  async stop() {
    const trace = await this.sdkTrace();
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await Promise.all(this.pending);
    fs.writeFileSync(path.join(this.dir, 'frames.json'), JSON.stringify(this.index));
    fs.writeFileSync(path.join(this.dir, 'trace.json'), JSON.stringify(trace));
    await this.browser.close();
    return { frames: this.index.length, trace: trace.length };
  }
}
