import type { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
    }
    (req as any).validatedBody = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation_error', details: parsed.error.flatten() });
    }
    (req as any).validatedQuery = parsed.data;
    next();
  };
}
