import type { LaunchOptions } from 'puppeteer';

export interface Credentials {
  username: string;
  password: string;
}

export interface ExamTimeSlot {
  datetime: Date | null;
  available: boolean;
}

export interface ExamDetails {
  centerCity: string;
  carPlateNumber: string;
}

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export interface ScraperOptions extends LaunchOptions {
  navDelayMs?: number;
  logLevel?: LogLevel;
  debug?: boolean;
  debugDir?: string;
}
