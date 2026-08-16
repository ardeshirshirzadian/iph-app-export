"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { gql } from "@apollo/client";
import { getApolloClient } from "@/lib/apolloClient";
import { useAuth } from "@/hooks/useAuth";

// Badge-check shape only — CartClient.jsx queries the full cart separately.
const CART_HAS_ITEMS_QUERY = gql`
  query { getAttendeeCart { id status cart_items { id } } }
`;

const CartContext = createContext({
  hasCart: false,
  refetchCart: async () => {},
});

export default function CartProvider({ children }) {
  // access_token (needed for this query) and the iph_user cookie are always
  // set/cleared together (see LoginForm.js finalizeSession, useAuth.logout,
  // apolloClient.js signOut) so isLoggedIn is an equivalent, simpler gate.
  const { isLoggedIn } = useAuth();
  const [hasCart, setHasCart] = useState(false);

  const fetchCart = useCallback(async () => {
    const client = getApolloClient();
    if (!client) return;
    try {
      const { data } = await client.query({ query: CART_HAS_ITEMS_QUERY, fetchPolicy: "network-only" });
      const cart = data?.getAttendeeCart;
      const items = cart?.cart_items || [];
      setHasCart(!!(cart?.id && !["paid", "cancelled", "expired"].includes(cart.status) && items.length > 0));
    } catch {
      setHasCart(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) {
      setHasCart(false);
      return;
    }
    fetchCart();
  }, [isLoggedIn, fetchCart]);

  return (
    <CartContext.Provider value={{ hasCart, refetchCart: fetchCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  return useContext(CartContext);
}
