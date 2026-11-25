import { createApp } from './app.js';
import { type Config, loadConfig } from './config.js';
import { createContainer } from './container.js';

/** Startup only (blueprint §5.3): config → container → app → listen, plus graceful shutdown. */

const SHUTDOWN_GRACE_MS = 10_000;

function start(config: Config): void {
  const container = createContainer(config);
  const { logger } = container.deps;
  const server = createApp(container.deps).listen(config.port, () => {
    logger.info('server.started', { port: config.port });
  });

  const shutdown = (signal: NodeJS.Signals) => {
    logger.info('server.stopping', { signal });
    setTimeout(() => {
      logger.error('server.shutdown_timeout', { graceMs: SHUTDOWN_GRACE_MS });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
    server.close((error) => {
      container.close();
      if (error) logger.error('server.close_failed', { error });
      process.exit(error ? 1 : 0);
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

try {
  start(loadConfig());
} catch (error) {
  // The logger isn't available until config is valid, so report directly.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'server.start_failed', message })}\n`);
  process.exit(1);
}
