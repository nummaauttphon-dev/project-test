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

  /** Returns false when the browser would not store the cart; the UI must then say so. */
  const setLines = useCallback((next: CartLine[]): boolean => {
    let saved: boolean;
    try {
      saved = writeCart(window.localStorage, next);
    } catch {
      saved = false; // accessing localStorage itself can throw
    }
    if (saved) window.dispatchEvent(new Event(CART_EVENT));
    return saved;
  }, []);

  return { lines, ready, setLines };
}
