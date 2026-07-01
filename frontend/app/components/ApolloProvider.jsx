'use client';

import { useState, useEffect } from 'react';
import { ApolloProvider } from '@apollo/client/react';
import { getApolloClient } from '@/lib/apolloClient';

export default function ApolloClientProvider({ children }) {
  const [client, setClient] = useState(null);

  useEffect(() => {
    setClient(getApolloClient());
  }, []);

  if (!client) return children;
  return <ApolloProvider client={client}>{children}</ApolloProvider>;
}
