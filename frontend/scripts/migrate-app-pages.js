const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PAGES = [
  { page_key: 'quest',     title_fa: 'Booth Quest',          default_path: '/quest' },
  { page_key: 'companies', title_fa: 'شرکت‌های نمایشگاه',  default_path: '/companies' },
  { page_key: 'panels',    title_fa: 'پنل‌ها و کارگاه‌ها', default_path: '/panels' },
  { page_key: 'gallery',   title_fa: 'گالری',               default_path: '/gallery' },
  { page_key: 'news',      title_fa: 'اخبار',               default_path: '/news' },
  { page_key: 'map',       title_fa: 'نقشه نمایشگاه',      default_path: '/map' },
  { page_key: 'badge',     title_fa: 'کارت بازدیدکننده',   default_path: '/badge' },
  { page_key: 'profile',   title_fa: 'پروفایل',            default_path: '/profile' },
  { page_key: 'register',  title_fa: 'ثبت‌نام',           default_path: '/register' },
  { page_key: 'book',      title_fa: 'کتاب نمایشگاه',     default_path: '/book' },
  { page_key: 'cart',      title_fa: 'سبد خرید',           default_path: '/cart' },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_pages (
        id           SERIAL       PRIMARY KEY,
        page_key     VARCHAR(50)  NOT NULL UNIQUE,
        title_fa     VARCHAR(100) NOT NULL,
        default_path VARCHAR(200) NOT NULL,
        custom_path  VARCHAR(200),
        is_active    BOOLEAN      NOT NULL DEFAULT true,
        updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    console.log('✓ app_pages table ready');

    for (const p of PAGES) {
      await client.query(
        `INSERT INTO app_pages (page_key, title_fa, default_path, is_active)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (page_key) DO NOTHING`,
        [p.page_key, p.title_fa, p.default_path]
      );
    }
    console.log(`✓ Seeded ${PAGES.length} pages`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
