import { errorMessage } from '../errors.ts';
import type ScraperDebug from '../scraper-debug.ts';
import type { DebugDetails, SnapshotPage } from '../scraper-debug.ts';

export interface StepExecutor {
  run<T>(step: string, action: () => Promise<T>, details?: DebugDetails): Promise<T>;
}

interface StepRunnerOptions {
  getPage: () => SnapshotPage | null;
  getRecorder: () => Pick<ScraperDebug, 'capture'>;
}

export default class StepRunner implements StepExecutor {
  private readonly getPage: StepRunnerOptions['getPage'];
  private readonly getRecorder: StepRunnerOptions['getRecorder'];

  constructor({ getPage, getRecorder }: StepRunnerOptions) {
    this.getPage = getPage;
    this.getRecorder = getRecorder;
  }

  async run<T>(step: string, action: () => Promise<T>, details: DebugDetails = {}): Promise<T> {
    await this.getRecorder().capture(this.getPage(), step, 'before', details);
    const started = Date.now();
    try {
      const result = await action();
      await this.getRecorder().capture(this.getPage(), step, 'after', {
        ...details, durationMs: Date.now() - started
      });
      return result;
    } catch (error) {
      await this.getRecorder().capture(this.getPage(), step, 'error', {
        ...details, durationMs: Date.now() - started,
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: errorMessage(error),
          ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
        }
      });
      throw error;
    }
  }
}
