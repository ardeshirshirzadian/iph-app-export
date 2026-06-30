export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const upstream = new URL('http://172.17.0.1:8000/logs');
  searchParams.forEach((value, key) => upstream.searchParams.set(key, value));
  const response = await fetch(upstream.toString());
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json' },
  });
}
