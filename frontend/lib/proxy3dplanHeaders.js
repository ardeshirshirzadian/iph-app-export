// Shared between app/api/proxy/3dplan/[...path]/route.js and
// app/static/[...path]/route.js -- both proxy https://3dplan.rasayesh.com so
// it can be embedded in our own <iframe> on /map. Kept in one place because
// both routes must apply the exact same header policy to the same upstream;
// letting the two lists drift would silently reopen the framing hole one of
// them was written to close.

// Headers we deliberately do not forward from the upstream response:
// - x-frame-options / content-security-policy(-report-only): the entire
//   reason these proxies exist is to not carry these forward.
// - content-encoding / content-length / transfer-encoding: fetch() already
//   transparently decoded the body, so forwarding the original encoding
//   label would mismatch what we're actually sending.
// - set-cookie: an upstream cookie relayed through our own Set-Cookie would
//   appear to the browser as if issued by us -- not needed for a read-only
//   plan viewer, so dropped rather than forwarded unexamined.
export const STRIPPED_PROXY_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
]);

// Re-assert framing policy rather than leave it unset: this content SHOULD
// be embeddable (that's the point of these proxies), but only from our own
// app -- not by any third party who discovers a proxy URL and points their
// own iframe at it, which would let them bypass 3dplan's original DENY via
// us as an unwitting relay.
export function applyFramingHeaders(headers) {
  headers.set('x-frame-options', 'SAMEORIGIN');
  headers.set('content-security-policy', "frame-ancestors 'self'");
}
