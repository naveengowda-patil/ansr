import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { Product } from '../src/domain/product.js';
import { UpstreamError } from '../src/errors.js';
import { type RunningServer, startServer, warmCatalogue } from '../src/startup.js';
import { createFakeStoreRepository, deferred } from './support/fakeStore.js';
import { FakeProductRepository, RecordingLogger } from './support/fakes.js';
import { createTestApp } from './support/testApp.js';

/** Startup warm-up (blueprint §5.6, §8.3). Real server on an ephemeral local port. */

const servers: Server[] = [];

async function start(productRepository: FakeProductRepository | ReturnType<typeof createFakeStoreRepository>['repository']) {
  const { app, logger } = createTestApp({ productRepository });
  const running: RunningServer = await startServer({ app, port: 0, productRepository, logger });
  servers.push(running.server);
  return { ...running, logger };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe('startServer', () => {
  it('serves requests while the warm-up is still pending (warm-up does not block startup)', async () => {
    const held = deferred<readonly Product[]>();
    const repository = new FakeProductRepository([]);
    repository.getAll = () => held.promise;

    const { server, warmUp } = await start(repository);
    await request(server).get('/health').expect(200, { status: 'ok' });

    held.resolve([]);
    await warmUp;
  });

  it('keeps running when the warm-up fails, and logs a warning', async () => {
    const repository = new FakeProductRepository([]);
    repository.failure = new UpstreamError('Product source responded with HTTP 503');

    const { server, warmUp, logger } = await start(repository);
    await expect(warmUp).resolves.toBeUndefined();

    expect(logger.withMessage('catalogue.warmup_failed')).toEqual([
      {
        level: 'warn',
        message: 'catalogue.warmup_failed',
        context: { reason: 'Product source responded with HTTP 503' },
      },
    ]);
    await request(server).get('/health').expect(200);
  });

  it('fills the catalogue cache so the first request does not call Fake Store', async () => {
    const fakeStore = createFakeStoreRepository();
    const { server, warmUp, logger } = await start(fakeStore.repository);
    await warmUp;

    expect(fakeStore.catalogueCalls()).toHaveLength(1);
    expect(logger.withMessage('catalogue.warmed')[0]?.context).toEqual({ products: 20 });

    await request(server).get('/products/featured').expect(200);
    expect(fakeStore.catalogueCalls()).toHaveLength(1);
  });
});

describe('warmCatalogue', () => {
  it('never rejects, even for unexpected errors', async () => {
    const repository = new FakeProductRepository([]);
    repository.failure = new TypeError('boom');
    const logger = new RecordingLogger();

    await expect(warmCatalogue(repository, logger)).resolves.toBeUndefined();
    expect(logger.withMessage('catalogue.warmup_failed')).toHaveLength(1);
  });
});
