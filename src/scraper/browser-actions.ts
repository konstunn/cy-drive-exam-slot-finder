import type { ElementHandle, EvaluateFunc, Frame } from 'puppeteer';
import { errorMessage } from '../errors.ts';
import type { BrowserContext } from '../types.ts';
import type DebugInspector from './debug-inspector.ts';
import type { StepExecutor } from './step-runner.ts';

const WAIT_UNTIL = 'domcontentloaded';

interface BrowserActionsOptions {
  steps: StepExecutor;
  inspector: Pick<DebugInspector, 'logFrameInputs'>;
  getNavDelayMs: () => number;
  log: (message: string) => void;
}

export default class BrowserActions {
  private readonly steps: StepExecutor;
  private readonly inspector: BrowserActionsOptions['inspector'];
  private readonly getNavDelayMs: () => number;
  private readonly log: (message: string) => void;

  constructor({ steps, inspector, getNavDelayMs, log }: BrowserActionsOptions) {
    this.steps = steps;
    this.inspector = inspector;
    this.getNavDelayMs = getNavDelayMs;
    this.log = log;
  }

  async preNavDelay(): Promise<void> {
    const delayMs = this.getNavDelayMs();
    if (delayMs && delayMs > 0) {
      this.log(`Waiting ${delayMs}ms before navigation`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  async waitForNamedInput(frame: Frame, name: string): Promise<void> {
    return this.steps.run('wait-for-input', async () => {
      try {
        await frame.waitForFunction(inputName => {
          return document.getElementsByName(inputName).length > 0;
        }, {}, name);
      } catch (error) {
        await this.inspector.logFrameInputs(frame);
        throw error;
      }
    }, { frame: frame.name(), inputName: name });
  }

  async typeNamedInput(frame: Frame, name: string, value: string): Promise<void> {
    return this.steps.run('type-input', async () => {
      const input = await frame.$(`input[name="${name}"]`);
      if (!input) {
        throw new Error(`Input not found: ${name}`);
      }

      await input.type(value);
    }, { frame: frame.name(), inputName: name });
  }

  async selectByValueOrText(context: BrowserContext, selector: string, valueOrText: string): Promise<void> {
    return this.steps.run('select-option', async () => {
      const selectedValue = await context.evaluate((selectSelector, expected) => {
        const select = document.querySelector<HTMLSelectElement>(selectSelector);
        if (!select) {
          return null;
        }

        const expectedText = String(expected).trim();
        const option = Array.from(select.options).find(item => {
          return item.value === expectedText || (item.textContent ?? '').trim() === expectedText;
        });

        if (!option) {
          return null;
        }

        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return option.value;
      }, selector, valueOrText);

      if (!selectedValue) {
        throw new Error(`Could not find option "${valueOrText}" for ${selector}`);
      }

      this.log(`Selected ${selector} option value=${selectedValue}`);
    }, { selector });
  }

  async retryEvaluate<Params extends unknown[], Func extends EvaluateFunc<Params>>(
    context: BrowserContext, fn: Func, ...args: Params
  ): Promise<Awaited<ReturnType<Func>>> {
    const maxAttempts = 3;
    const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

    for (let attempt = 1; ; attempt++) {
      try {
        return await context.evaluate(fn, ...args);
      } catch (err) {
        const msg = errorMessage(err);
        if (msg.includes('Execution context was destroyed') || msg.includes('Protocol error') || attempt === maxAttempts) {
          if (attempt === maxAttempts) throw err;
          await delay(500 * attempt);
          continue;
        }
        throw err;
      }
    }
  }

  async waitForInputButtonByValue(context: BrowserContext, value: string): Promise<ElementHandle<HTMLInputElement>> {
    return this.steps.run('wait-for-button', async () => {
      await context.waitForFunction(expectedValue => {
        return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="button"]')).some(input => {
          return input.value.trim() === expectedValue;
        });
      }, {}, value);

      return context.evaluateHandle(expectedValue => {
        const input = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="button"]')).find(input => {
          return input.value.trim() === expectedValue;
        });
        if (!input) throw new Error(`Button disappeared: ${expectedValue}`);
        return input;
      }, value);
    }, { expectedValue: value });
  }

  async clickAndWaitForNavigation(context: BrowserContext, target: string | ElementHandle<Element>): Promise<void> {
    // Keep journal step names stable for both ways of identifying the element.
    const step = typeof target === 'string' ? 'click-and-navigate' : 'click-element-and-navigate';
    return this.steps.run(step, async () => {
      await Promise.all([
        context.waitForNavigation({ waitUntil: WAIT_UNTIL }),
        typeof target === 'string' ? context.click(target) : target.click()
      ]);
    }, typeof target === 'string' ? { selector: target } : {});
  }
}
