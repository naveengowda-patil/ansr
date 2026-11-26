import { createApp } from './app.js';
import { type Config, loadConfig } from './config.js';
import { createContainer } from './container.js';
import { startServer } from './startup.js';

/** Entry point (blueprint §5.3): config → container → app → startServer, plus graceful shutdown. */

const SHUTDOWN_GRACE_MS = 10_000;

async function start(config: Config): Promise<void> {
  const container = createContainer(config);
  const { logger, productRepository } = container.deps;
  const { server } = await startServer({
    app: createApp(container.deps),
    port: config.port,
    productRepository,
    logger,
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

function reportStartFailure(error: unknown): never {
  // The logger may not exist yet (invalid config), so report directly.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `${JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'server.start_failed', message })}\n`,
  );
  process.exit(1);
}

try {
  start(loadConfig()).catch(reportStartFailure);
} catch (error) {
  reportStartFailure(error);
}
