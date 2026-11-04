import type { Frame, Page } from 'puppeteer';
import type { Credentials } from '../../types.ts';
import type BrowserActions from '../browser-actions.ts';
import type DebugInspector from '../debug-inspector.ts';
import type { StepExecutor } from '../step-runner.ts';

const LOGIN_URL = 'https://rtd.mcw.gov.cy';
const FRAME_NAME = 'top';
const FRAME_URL_PART = 'TPRTDLogo.jsp';
const USERNAME_INPUT = 'h_USERNAME';
const PASSWORD_INPUT = 'h_PASSWORD';
const SUBMIT_BUTTON = 'input[type="submit"][name="h_LOGIN"]';

interface LoginPageOptions {
  page: Page;
  actions: Pick<BrowserActions, 'waitForNamedInput' | 'typeNamedInput' | 'preNavDelay' | 'clickAndWaitForNavigation'>;
  inspector: Pick<DebugInspector, 'logFrameInputs'>;
  steps: StepExecutor;
  log: (message: string) => void;
}

export default class LoginPage {
  private readonly options: Readonly<LoginPageOptions>;

  constructor(options: LoginPageOptions) {
    this.options = options;
  }

  async login(creds: Credentials): Promise<void> {
    const { page, actions, inspector, steps, log } = this.options;
    log(`Opening login page: ${LOGIN_URL}`);
    await steps.run('open-login-page',
      () => page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }), { targetUrl: LOGIN_URL });
    log('Login page loaded');

    const frame = await this.getLoginFrame();
    log(`Using frame "${frame.name()}" at ${frame.url()}`);
    await inspector.logFrameInputs(frame);

    log('Waiting for username input');
    await actions.waitForNamedInput(frame, USERNAME_INPUT);
    log('Typing username');
    await actions.typeNamedInput(frame, USERNAME_INPUT, creds.username);

    log('Waiting for password input');
    await actions.waitForNamedInput(frame, PASSWORD_INPUT);
    log('Typing password');
    await actions.typeNamedInput(frame, PASSWORD_INPUT, creds.password);

    log('Clicking login submit and waiting for navigation');
    await actions.preNavDelay();
    await actions.clickAndWaitForNavigation(frame, SUBMIT_BUTTON);
    log('Login navigation completed');
  }

  private async getLoginFrame(): Promise<Frame> {
    const { page, log } = this.options;
    log(`Available frames: ${page.frames().map(frame => {
      const name = frame.name() || '<unnamed>';
      return `${name} (${frame.url()})`;
    }).join(', ')}`);

    const matches = (frame: Frame) => frame.name() === FRAME_NAME && frame.url().includes(FRAME_URL_PART);
    const frame = page.frames().find(matches);
    if (frame) return frame;

    log(`Waiting for frame named "${FRAME_NAME}" with URL containing "${FRAME_URL_PART}"`);
    return page.waitForFrame(matches);
  }
}
