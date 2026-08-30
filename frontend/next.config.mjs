import path from 'path';
import { fileURLToPath } from 'url';
import withSerwistInit from '@serwist/next';
import { globSync } from 'glob';

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

// public/uploads is bind-mounted at container runtime (docker-compose/run
// -v /home/ubuntu/iph-superapp-uploads:/app/public/uploads), so it never
// contains what was baked into the image at build time. Precaching it 404s
// on install and permanently wedges the service worker.
//
// @serwist/next's `globPublicPatterns` option is the only user-facing lever
// for its public-folder precache scan, but it's passed straight into a
// glob() call whose `ignore` list is hardcoded internally (no config
// override) and whose pattern array doesn't support `!` negation in this
// glob version (verified directly) -- neither the webpack-asset `exclude`
// filter nor `manifestTransforms` reach these entries either, since they're
// injected via InjectManifest's `additionalPrecacheEntries` after both run.
// So the file list is precomputed here, with our own `ignore`, and passed
// in as literal filenames (globPublicPatterns accepts exact paths, not just
// wildcards) -- Serwist still handles the actual revision hashing normally.
const publicPrecacheFiles = globSync('**/*', {
  nodir: true,
  follow: true,
  cwd: path.join(__dirname, 'public'),
  ignore: ['swe-worker-*.js', 'sw.js', 'sw.js.map', 'uploads/**'],
});

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.js',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
  // ServiceWorkerRegistrar.js already registers /sw.js manually; keep Serwist's
  // own auto-registration off to avoid two competing registration paths.
  register: false,
  globPublicPatterns: publicPrecacheFiles,
});

export default withSerwist(nextConfig);
