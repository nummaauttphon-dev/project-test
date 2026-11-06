"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { CART_STORAGE_KEY, readCart, writeCart, type CartLine } from "./cart-storage";

const CART_EVENT = "cart:change";

function subscribe(onChange: () => void) {
  window.addEventListener(CART_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CART_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function snapshot(): string {
  try {
    return window.localStorage.getItem(CART_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The cart in localStorage as React state. `ready` is false during server render and hydration. */
export function useCart() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const ready = raw !== null;
  const lines = useMemo<CartLine[]>(
    () => (raw ? readCart({ getItem: () => raw }) : []),
    [raw],
  );

  const setLines = useCallback((next: CartLine[]) => {
    try {
      writeCart(window.localStorage, next);
    } catch {
      // localStorage can be blocked entirely; the cart then stays empty.
    }
    window.dispatchEvent(new Event(CART_EVENT));
  }, []);

  return { lines, ready, setLines };
}
