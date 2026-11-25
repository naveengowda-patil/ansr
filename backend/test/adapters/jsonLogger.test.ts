import { describe, expect, it } from 'vitest';
import { JsonLogger } from '../../src/adapters/logging/JsonLogger.js';

const fixedNow = () => new Date('2026-11-25T10:00:00.000Z');

describe('JsonLogger', () => {
  it('writes one JSON line per entry with time, level, message and context', () => {
    const lines: string[] = [];
    new JsonLogger('info', (line) => lines.push(line), fixedNow).warn('search.unsupported', { param: 'sort' });

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { time: '2026-11-25T10:00:00.000Z', level: 'warn', msg: 'search.unsupported', param: 'sort' },
    ]);
  });

  it('drops entries below the configured level', () => {
    const lines: string[] = [];
    const logger = new JsonLogger('warn', (line) => lines.push(line), fixedNow);
    logger.debug('a');
    logger.info('b');
    logger.error('c');

    expect(lines.map((line) => JSON.parse(line).msg)).toEqual(['c']);
  });

  it('serialises errors, including their cause', () => {
    const lines: string[] = [];
    const error = new Error('outer', { cause: new Error('inner') });
    new JsonLogger('info', (line) => lines.push(line), fixedNow).error('request.failed', { error });

    const logged = JSON.parse(lines[0] ?? '{}');
    expect(logged.error).toMatchObject({ name: 'Error', message: 'outer', cause: { message: 'inner' } });
    expect(logged.error.stack).toEqual(expect.any(String));
  });
});
