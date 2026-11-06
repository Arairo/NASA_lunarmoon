// Renders the in-app video tutorial to an MP4 with the voice-over, for
// sharing outside the app (and for the "Download" button in the player).
// Every frame is drawn by the real player at an exact time, so the file
// matches what users see in the app.
//
//   npm run build && npx vite preview --port 4174     # in another terminal
//   node tools/tutorial/render-video.cjs http://localhost:4174/
//
// Writes public/tutorial/lunar-site-planner-tutorial.mp4. Needs Playwright
// and ffmpeg (libx264, aac).
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BASE = process.argv[2] || 'http://localhost:4174/';
const ROOT = path.resolve(__dirname, '../..');
const AUDIO = path.join(ROOT, 'public/tutorial/narration.mp3');
const OUT = path.join(ROOT, 'public/tutorial/lunar-site-planner-tutorial.mp4');
const FPS = Number(process.env.FPS || 30);
const W = 1920;
const H = 1080;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(120000);
  await page.goto(`${BASE}?tutorial-render`);
  await page.waitForFunction(() => window.tutorialRender);
  await page.evaluate(() => window.tutorialRender.ready());
  await page.evaluate(() => document.fonts.ready);
  const duration = await page.evaluate(() => window.tutorialRender.duration);
  const frames = Math.ceil(duration * FPS);

  const ff = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-i', AUDIO,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart',
    OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c ? rej(new Error(`ffmpeg exited ${c}`)) : res())));

  const started = Date.now();
  for (let n = 0; n < frames; n++) {
    await page.evaluate((t) => window.tutorialRender.frame(t), n / FPS);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
    if (n % (FPS * 10) === 0) {
      const el = (Date.now() - started) / 1000;
      console.log(`${(n / FPS).toFixed(0)}s / ${duration.toFixed(0)}s  (${el.toFixed(0)}s elapsed)`);
    }
  }
  ff.stdin.end();
  await done;
  await browser.close();
  console.log(`wrote ${OUT}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
