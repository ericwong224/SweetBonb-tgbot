import { EventEmitter } from 'node:events';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeLogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

class RuntimeLogBus extends EventEmitter {
  private seq = 0;
  private readonly entries: RuntimeLogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 500) {
    super();
    this.maxEntries = maxEntries;
    this.setMaxListeners(50);
  }

  configure(maxEntries: number): void {
    this.maxEntries = maxEntries;
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  append(level: LogLevel, category: string, message: string, data?: Record<string, unknown>): RuntimeLogEntry {
    const entry: RuntimeLogEntry = {
      id: ++this.seq,
      ts: new Date().toISOString(),
      level,
      category,
      message,
      data,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.emit('entry', entry);

    const prefix = `[${entry.ts}] [${level}] [${category}]`;
    const line = data ? `${prefix} ${message} ${JSON.stringify(data)}` : `${prefix} ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);

    return entry;
  }

  getRecent(limit = 200): RuntimeLogEntry[] {
    return this.entries.slice(-limit);
  }
}

export const runtimeLog = new RuntimeLogBus();

export function logInfo(category: string, message: string, data?: Record<string, unknown>) {
  return runtimeLog.append('info', category, message, data);
}

export function logWarn(category: string, message: string, data?: Record<string, unknown>) {
  return runtimeLog.append('warn', category, message, data);
}

export function logError(category: string, message: string, data?: Record<string, unknown>) {
  return runtimeLog.append('error', category, message, data);
}

export function logDebug(category: string, message: string, data?: Record<string, unknown>) {
  return runtimeLog.append('debug', category, message, data);
}
