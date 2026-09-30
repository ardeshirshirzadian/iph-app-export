import { getCurrentEventId } from '@/lib/currentEvent';

export const dynamic = 'force-dynamic';

// Digital Asset Links payload is tied to each event's own Android app
// package + signing-cert fingerprint -- a rare-changing, security-sensitive
// value with no admin-editable use case (nobody edits a cert fingerprint
// from a form), so it lives here as code rather than in app_settings, same
// treatment as lib/getThemeColors.js's DEFAULT_COLORS. Hand-formatted (not
// JSON.stringify output) so IranPharma's entry stays byte-identical to the
// static /public/.well-known/assetlinks.json file this route replaces --
// see [[iph-android-app-twa]] memory / commit message for why a single
// static file couldn't serve both events' own package names.
const ASSETLINKS = {
  1: `[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.iphexpo.app",
      "sha256_cert_fingerprints": ["06:0B:C5:45:85:88:99:57:C3:2F:F1:B6:16:F5:02:AB:A0:B0:FA:A4:4D:E7:E2:63:EC:73:C7:44:9A:2E:02:37"]
    }
  },
  {
    "relation": ["check_validation"],
    "target": {
      "namespace": "cafebazaar_twa",
      "package_name": "com.iphexpo.app"
    }
  }
]
`,
  2: `[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "com.irancosmetica.app",
      "sha256_cert_fingerprints": ["49:C7:22:09:FB:8E:81:5D:F2:A3:0E:A3:5B:5D:D3:CD:D2:51:A2:11:DD:0C:35:12:49:84:55:4F:50:30:6C:BC"]
    }
  },
  {
    "relation": ["check_validation"],
    "target": {
      "namespace": "cafebazaar_twa",
      "package_name": "com.irancosmetica.app"
    }
  }
]
`,
};

export async function GET() {
  const eventId = await getCurrentEventId();
  const body = ASSETLINKS[eventId] ?? ASSETLINKS[1];
  return new Response(body, {
    headers: { 'content-type': 'application/json' },
  });
}
