import 'server-only';
import { query } from './db';

const DEFAULT_IDENTITY = {
  title: 'Iranpharma',
  short_name: 'IPH',
  description: 'Iran Pharma Exhibition Super App',
};

export async function getAppIdentity() {
  try {
    const result = await query(
      "SELECT value FROM app_settings WHERE key = 'app_identity'"
    );
    if (result.rows.length === 0) return DEFAULT_IDENTITY;
    const stored = result.rows[0].value;
    return { ...DEFAULT_IDENTITY, ...stored };
  } catch (err) {
    console.error('getAppIdentity error:', err);
    return DEFAULT_IDENTITY;
  }
}
