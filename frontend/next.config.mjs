import path from 'path';
import { fileURLToPath } from 'url';
import withSerwistInit from '@serwist/next';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [];
  },
  // Redis-backed storage for unstable_cache (Phase 3's ~46 tags) — see
  // REDIS_MIGRATION_PHASE1_POC.md for why `cacheHandler` (singular) is the
  // correct config key here, not `cacheHandlers` (plural, 'use cache' only).
  cacheHandler: path.resolve(__dirname, 'lib/cache-handler-redis.js'),
  cacheMaxMemorySize: 0,
};

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.js',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
  // ServiceWorkerRegistrar.js already registers /sw.js manually; keep Serwist's
  // own auto-registration off to avoid two competing registration paths.
  register: false,
});

export default withSerwist(nextConfig);
