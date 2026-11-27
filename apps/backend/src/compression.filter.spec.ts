import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { shouldCompress } from './compression.filter';

const request = {} as Request;
const response = (contentType: string) =>
  ({
    getHeader: (name: string) =>
      name.toLowerCase() === 'content-type' ? contentType : undefined,
  }) as unknown as Response;

describe('compression filter', () => {
  it('skips server-sent events', () => {
    expect(shouldCompress(request, response('text/event-stream'))).toBe(false);
  });

  it('keeps compression for JSON', () => {
    expect(shouldCompress(request, response('application/json'))).toBe(true);
  });
});
