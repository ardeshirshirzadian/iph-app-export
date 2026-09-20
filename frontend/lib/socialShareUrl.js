// Shared by the social-share modal and API. No server-only dependencies.
// Return the original, trimmed evidence URL, or null when it is invalid.
export function validateSocialShareUrl(input) {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  // PostgreSQL VARCHAR counts characters, not UTF-16 code units.
  if (!value || Array.from(value).length > 1000) return null;

  // Prevent URL-parser repairs: missing slashes, backslashes, embedded
  // whitespace/control characters, and unpaired UTF-16 surrogates.
  if (!/^https:\/\//i.test(value)) return null;
  if (/[\s\u0000-\u001f\u007f-\u009f\\\uD800-\uDFFF]/u.test(value)) return null;
  // Malformed percent escapes are otherwise accepted in paths by URL.
  if (/%(?![0-9a-f]{2})/i.test(value)) return null;

  const authority = value.slice(8).split(/[/?#]/, 1)[0];
  // Empty authority (extra slash), userinfo (even empty), or empty port.
  if (!authority || authority.includes('@') || authority.endsWith(':')) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    // A trailing DNS root dot is valid, but empty labels elsewhere are not.
    if (parsed.hostname.replace(/\.$/, '').split('.').some(label => !label)) return null;
    // Reject abbreviated/hex/octal IPv4 spellings that URL silently expands.
    // This only identifies the parser's IPv4 output; URL validates the host.
    if (/^[0-9.]+$/.test(parsed.hostname)) {
      const submittedHost = authority.split(':', 1)[0];
      if (submittedHost !== parsed.hostname) return null;
    }
    return value;
  } catch {
    return null;
  }
}
