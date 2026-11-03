const fs = require('node:fs/promises');
const path = require('node:path');

// Runs in the browser. Clone the DOM so capturing live form state never changes it.
function serializeDocument() {
  const clone = document.documentElement.cloneNode(true);
  const controls = document.querySelectorAll('input, textarea, select');
  const copies = clone.querySelectorAll('input, textarea, select');
  controls.forEach((control, index) => {
    const copy = copies[index];
    const sensitive = control.type === 'password'
      || /password|h_USERNAME/i.test(`${control.name} ${control.id}`);
    if (control.tagName === 'INPUT') {
      copy.setAttribute('value', sensitive ? '[REDACTED]' : control.value);
      copy.toggleAttribute('checked', control.checked);
    } else if (control.tagName === 'TEXTAREA') {
      copy.textContent = sensitive ? '[REDACTED]' : control.value;
    } else {
      Array.from(copy.options).forEach((option, optionIndex) => {
        option.toggleAttribute('selected', control.options[optionIndex].selected);
      });
    }
  });
  // Inline frame documents are captured separately with the same redaction.
  // Keeping the original srcdoc would duplicate unredacted initial form values.
  clone.querySelectorAll('iframe[srcdoc]').forEach(frame => {
    frame.setAttribute('srcdoc', '[See separate frame HTML file]');
  });
  const doctype = document.doctype
    ? new XMLSerializer().serializeToString(document.doctype) + '\n'
    : '';
  return doctype + clone.outerHTML;
}

async function withTimeout(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Debug capture timed out')), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

class ScraperDebug {
  constructor({ enabled = false, rootDir = 'debug', getSecrets = () => [],
    onDirectory = () => {}, onSnapshot = () => {}, onWarning = () => {} } = {}) {
    this.enabled = enabled;
    this.rootDir = rootDir;
    this.getSecrets = getSecrets;
    this.onDirectory = onDirectory;
    this.onSnapshot = onSnapshot;
    this.onWarning = onWarning;
    this.directory = null;
    this.sequence = 0;
  }

  redact(value) {
    let text = String(value);
    const variants = new Set();
    for (const secret of this.getSecrets().filter(Boolean)) {
      const raw = String(secret);
      const html = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      for (const variant of [raw, html, encodeURIComponent(raw),
        new URLSearchParams({ value: raw }).toString().slice('value='.length)]) {
        variants.add(variant);
        variants.add(JSON.stringify(variant).slice(1, -1));
      }
    }
    for (const secret of [...variants].sort((a, b) => b.length - a.length)) {
      text = text.split(secret).join('[REDACTED]');
    }
    return text;
  }

  async screenshot(page, frames, filename) {
    const masks = [];
    try {
      for (const frame of frames) {
        const mask = await withTimeout(frame.evaluateHandle(() => {
          const style = document.createElement('style');
          style.textContent = `input[type="password"], input[name*="password" i],
            input[id*="password" i], input[name="h_USERNAME"] {
              visibility: hidden !important;
            }`;
          document.documentElement.appendChild(style);
          return style;
        }), 3000);
        masks.push(mask);
      }
      await withTimeout(page.screenshot({ path: filename, fullPage: true }), 5000);
    } finally {
      for (const mask of masks) {
        try {
          await withTimeout(mask.evaluate(style => style.remove()), 1000);
        } catch (_) {
          // Navigation may already have removed the document.
        } finally {
          await mask.dispose().catch(() => {});
        }
      }
    }
  }

  // Diagnostic failures are contained here and never replace a scraping error.
  async capture(page, step, phase, details = {}) {
    if (!this.enabled) return;
    try {
      if (!this.directory) {
        await fs.mkdir(path.resolve(this.rootDir), { recursive: true, mode: 0o700 });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        this.directory = await fs.mkdtemp(path.join(path.resolve(this.rootDir), `${timestamp}-`));
        this.onDirectory(this.directory);
      }
      const slug = String(step).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80);
      const snapshot = `${String(++this.sequence).padStart(3, '0')}-${slug}-${phase}`;
      const directory = path.join(this.directory, snapshot);
      await fs.mkdir(directory, { mode: 0o700 });
      const entry = {
        timestamp: new Date().toISOString(), step, phase, snapshot,
        url: null, ...details, frames: []
      };
      if (page && !page.isClosed()) {
        entry.url = page.url();
        const mainFrame = page.mainFrame();
        const frames = [mainFrame, ...page.frames().filter(frame => frame !== mainFrame)];
        for (const [index, frame] of frames.entries()) {
          const info = { name: frame.name(), url: frame.url() };
          entry.frames.push(info);
          try {
            const html = await withTimeout(frame.evaluate(serializeDocument), 3000);
            const filename = index === 0 ? 'page.html' : `frame-${String(index).padStart(2, '0')}.html`;
            await fs.writeFile(path.join(directory, filename), this.redact(html), { mode: 0o600 });
            info.file = filename;
          } catch (error) {
            info.error = error.message;
          }
        }
        if (phase === 'error') {
          try {
            await this.screenshot(page, frames, path.join(directory, 'screenshot.png'));
            entry.screenshot = 'screenshot.png';
          } catch (error) {
            entry.screenshotError = error.message;
          }
        }
      }
      await fs.appendFile(path.join(this.directory, 'steps.jsonl'),
        JSON.stringify(entry, (_key, value) => typeof value === 'string'
          ? this.redact(value) : value) + '\n', { mode: 0o600 });
      this.onSnapshot(directory);
      return directory;
    } catch (error) {
      this.onWarning(this.redact(`Could not save debug snapshot: ${error.message}`));
    }
  }
}

module.exports = ScraperDebug;
