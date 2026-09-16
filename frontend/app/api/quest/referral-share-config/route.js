import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { query } from '@/lib/db';
import { getCurrentEventId } from '@/lib/currentEvent';
import { isUnlimitedReferralActive } from '@/lib/referralUnlimited';

// Same split as every other config route in this feature: admin-authored
// template content is cached (rarely changes), the "is this even on" gate
// is checked live on every call.
const getCachedReferralShareTemplate = unstable_cache(
  async (currentEventId) => {
    const result = await query(
      "SELECT value FROM app_settings WHERE event_id = $1 AND key = 'referral_share_template_config'",
      [currentEventId]
    );
    return result.rows[0]?.value ?? null;
  },
  ['referral-share-config'],
  { tags: ['referral-share-config'], revalidate: 300 }
);

export async function GET() {
  try {
    const currentEventId = await getCurrentEventId();

    // Same gate as Parts 1/2 (per this round's decision 1) -- the share
    // entry point is scoped to the same unlimited-mode mission being
    // active, not to any referral_code mission existing at all.
    const active = await isUnlimitedReferralActive(currentEventId);
    if (!active) {
      return NextResponse.json({ active: false, template: null });
    }

    const template = await getCachedReferralShareTemplate(currentEventId);
    // Hidden until an admin has actually placed at least one element --
    // "the key exists" (even the default template) is not enough on its
    // own, since an admin who never opened this tab yet shouldn't have a
    // half-designed/blank image go out to real users.
    if (!template || !Array.isArray(template.elements) || template.elements.length === 0) {
      return NextResponse.json({ active: false, template: null });
    }

    return NextResponse.json({ active: true, template });
  } catch (e) {
    console.error('[quest/referral-share-config GET]', e.message);
    return NextResponse.json({ active: false, template: null });
  }
}
