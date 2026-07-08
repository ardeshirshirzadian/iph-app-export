const GQL = 'https://api.rasayesh.com/graphql';

export async function fetchPublicGraphQL(query, variables = {}, eventOrigin) {
  const res = await fetch(GQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-rasayesh-site': 'iph',
      origin: eventOrigin,
      referer: `${eventOrigin}/`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    const err = new Error(json.errors[0]?.message || 'GraphQL error');
    err.graphQLErrors = json.errors;
    throw err;
  }
  return json;
}
