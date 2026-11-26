import { Router } from 'express';

/** GET /health — liveness only; never calls upstream services (blueprint §6.2, D-006). */
export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return router;
}
