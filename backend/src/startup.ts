import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Logger } from './ports/Logger.js';
import type { ProductRepository } from './ports/ProductRepository.js';

/** Startup sequence (blueprint §5.6, §8.3): listen first, then warm the catalogue cache. */

export interface StartServerOptions {
  readonly app: RequestListener;
  readonly port: number;
  readonly productRepository: ProductRepository;
  readonly logger: Logger;
}

export interface RunningServer {
  readonly server: Server;
  readonly port: number;
  /** Settles when the warm-up finishes; never rejects. */
  readonly warmUp: Promise<void>;
}

/** Starts listening, then kicks off one catalogue load without blocking or failing startup. */
export function startServer(options: StartServerOptions): Promise<RunningServer> {
  const { app, port, productRepository, logger } = options;
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      const actualPort = (server.address() as AddressInfo).port;
      logger.info('server.started', { port: actualPort });
      resolve({ server, port: actualPort, warmUp: warmCatalogue(productRepository, logger) });
    });
  });
}

/** Loads the catalogue once so the first user request is served from the cache. Never rejects. */
export async function warmCatalogue(productRepository: ProductRepository, logger: Logger): Promise<void> {
  try {
    const products = await productRepository.getAll();
    logger.info('catalogue.warmed', { products: products.length });
  } catch (error) {
    logger.warn('catalogue.warmup_failed', { reason: error instanceof Error ? error.message : String(error) });
  }
}
