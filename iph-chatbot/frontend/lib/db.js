import { Pool } from 'pg';

// Use globalThis to survive Next.js hot-reloads in dev without leaking pools
if (!globalThis._pgPool) {
  globalThis._pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  globalThis._pgPool.on('error', (err) => {
    console.error('Unexpected PostgreSQL client error', err);
  });
}

const pool = globalThis._pgPool;

export async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export default function getPool() {
  return pool;
}
