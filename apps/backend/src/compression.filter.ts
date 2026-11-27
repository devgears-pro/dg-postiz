import compression from 'compression';
import type { Request, Response } from 'express';

export const shouldCompress = (req: Request, res: Response) => {
  if (res.getHeader('Content-Type') === 'text/event-stream') return false;
  return compression.filter(req, res);
};
