import type { Frame } from 'puppeteer';
import type { BrowserContext } from '../types.ts';

export default class DebugInspector {
  private readonly log: (message: string) => void;

  constructor(log: (message: string) => void) {
    this.log = log;
  }

  async logFrameInputs(frame: Frame): Promise<void> {
    const inputs = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('input')).map(input => {
        const type = input.getAttribute('type') || '<no type>';
        const name = input.getAttribute('name') || '<no name>';
        const id = input.id || '<no id>';

        return `${type} name=${name} id=${id}`;
      });
    });

    this.log(`Inputs in frame "${frame.name()}": ${inputs.length ? inputs.join(', ') : '<none>'}`);
  }

  async logClickableControls(context: BrowserContext, label = 'frame'): Promise<void> {
    const controls = await context.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).map(button => {
        const type = button.getAttribute('type') || '<no type>';
        const name = button.getAttribute('name') || '<no name>';
        const id = button.id || '<no id>';
        const text = (button.textContent ?? '').trim() || '<no text>';

        return `button type=${type} name=${name} id=${id} text=${text}`;
      });

      const submitInputs = Array.from(document.querySelectorAll('input[type="submit"]')).map(input => {
        const name = input.getAttribute('name') || '<no name>';
        const id = input.id || '<no id>';
        const value = input.getAttribute('value') || '<no value>';

        return `submit name=${name} id=${id} value=${value}`;
      });

      const buttonInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="button"]')).map(input => {
        const name = input.getAttribute('name') || '<no name>';
        const id = input.id || '<no id>';
        const value = input.getAttribute('value') || '<no value>';
        const onclick = input.getAttribute('onclick') || '<no onclick>';

        return `input-button name=${name} id=${id} value=${value} onclick=${onclick}`;
      });

      return buttons.concat(submitInputs, buttonInputs);
    });

    this.log(`Clickable controls in ${label}: ${controls.length ? controls.join(', ') : '<none>'}`);
  }

  async logSelectOptions(context: BrowserContext, selector: string): Promise<void> {
    const options = await context.evaluate(selectSelector => {
      const select = document.querySelector<HTMLSelectElement>(selectSelector);
      if (!select) {
        return null;
      }

      return Array.from(select.options).map(option => {
        return `value=${option.value} text=${(option.textContent ?? '').trim()}`;
      });
    }, selector);

    this.log(`Options for ${selector}: ${options ? options.join(', ') : '<select not found>'}`);
  }

  async logCalendarNavigationControls(context: BrowserContext): Promise<void> {
    const controls = await context.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(image => {
        const title = image.getAttribute('title') || '<no title>';
        const src = image.getAttribute('src') || '<no src>';
        const onclick = image.getAttribute('onclick') || '<no onclick>';

        return `img title=${title} src=${src} onclick=${onclick}`;
      });
    });

    this.log(`Calendar image controls: ${controls.length ? controls.join(', ') : '<none>'}`);
  }
}
