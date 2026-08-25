"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { CursorGlow, ScrollProgress } from "@/components/interactive";

/* ============================ TOAST ================================= */
type ToastType = "info" | "success" | "error";
interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within Providers");
  return ctx;
}

function ToastViewport({ items }: { items: ToastItem[] }) {
  const reduce = useReducedMotion();

  const tone: Record<ToastType, string> = {
    info: "border-whisper-border text-ivory",
    success: "border-signal/40 text-signal",
    error: "border-alert/40 text-alert",
  };

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-[80] flex w-[min(92vw,22rem)] -translate-x-1/2 flex-col gap-2">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className={cn(
              "pointer-events-auto rounded-cravee border bg-charcoal/90 px-4 py-3 text-sm font-medium shadow-[0_20px_40px_-15px_rgba(0,0,0,0.6)] backdrop-blur-xl",
              tone[t.type]
            )}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ============================ AUTH ================================== */
interface AuthUser {
  name: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  signIn: (email: string) => void;
  signOut: () => void;
  /** Run `action` only when signed in; otherwise bounce to sign-in. */
  requireAuth: (action?: () => void, redirect?: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within Providers");
  return ctx;
}

const AUTH_KEY = "craavee_user";

/* ============================ CART ================================== */
export interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  name: string;
  price: number;
  image?: string;
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  total: number;
  add: (item: Omit<CartItem, "quantity">, qty?: number) => void;
  remove: (id: string) => void;
  updateQty: (id: string, qty: number) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within Providers");
  return ctx;
}

const CART_KEY = "craavee_cart";

/* ========================== ADDRESS ================================= */
export interface DeliveryAddress {
  label: string;
  line: string;
  area?: string;
  city?: string;
  pincode?: string;
  coords?: { lat: number; lng: number };
}

interface AddressContextValue {
  address: DeliveryAddress | null;
  saveAddress: (a: DeliveryAddress) => void;
}

const AddressContext = createContext<AddressContextValue | null>(null);

export function useAddress() {
  const ctx = useContext(AddressContext);
  if (!ctx) throw new Error("useAddress must be used within Providers");
  return ctx;
}

const ADDRESS_KEY = "craavee_address";

/* =========================== PROVIDERS ============================== */
export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  /* ---- Toast ---- */
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }, []);

  /* ---- Auth ---- */
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const signIn = useCallback(
    (email: string) => {
      const name = email.split("@")[0].replace(/[._-]/g, " ");
      const u = {
        email,
        name: name.charAt(0).toUpperCase() + name.slice(1),
      };
      setUser(u);
      try {
        localStorage.setItem(AUTH_KEY, JSON.stringify(u));
      } catch {
        /* ignore */
      }
    },
    []
  );

  const signOut = useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const requireAuth = useCallback(
    (action?: () => void, redirect = "/shop") => {
      if (user) {
        action?.();
        return true;
      }
      const target = encodeURIComponent(redirect);
      router.push(`/sign-in?redirect=${target}`);
      return false;
    },
    [user, router]
  );

  /* ---- Cart ---- */
  const [items, setItems] = useState<CartItem[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const persistCart = useCallback((next: CartItem[]) => {
    setItems(next);
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const add = useCallback(
    (item: Omit<CartItem, "quantity">, qty = 1) => {
      const existing = items.find((i) => i.id === item.id);
      if (existing) {
        persistCart(
          items.map((i) =>
            i.id === item.id ? { ...i, quantity: i.quantity + qty } : i
          )
        );
      } else {
        persistCart([...items, { ...item, quantity: qty }]);
      }
    },
    [items, persistCart]
  );

  const remove = useCallback(
    (id: string) => persistCart(items.filter((i) => i.id !== id)),
    [items, persistCart]
  );

  const updateQty = useCallback(
    (id: string, qty: number) => {
      if (qty <= 0) {
        persistCart(items.filter((i) => i.id !== id));
        return;
      }
      persistCart(
        items.map((i) => (i.id === id ? { ...i, quantity: qty } : i))
      );
    },
    [items, persistCart]
  );

  const clear = useCallback(() => persistCart([]), [persistCart]);

  /* ---- Address ---- */
  const [address, setAddress] = useState<DeliveryAddress | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ADDRESS_KEY);
      if (raw) setAddress(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  const saveAddress = useCallback((a: DeliveryAddress) => {
    setAddress(a);
    try {
      localStorage.setItem(ADDRESS_KEY, JSON.stringify(a));
    } catch {
      /* ignore */
    }
  }, []);

  const count = useMemo(
    () => items.reduce((s, i) => s + i.quantity, 0),
    [items]
  );
  const total = useMemo(
    () => items.reduce((s, i) => s + i.price * i.quantity, 0),
    [items]
  );

  const toastValue = useMemo<ToastContextValue>(
    () => ({ toast }),
    [toast]
  );
  const authValue = useMemo<AuthContextValue>(
    () => ({ user, signIn, signOut, requireAuth }),
    [user, signIn, signOut, requireAuth]
  );
  const cartValue = useMemo<CartContextValue>(
    () => ({ items, count, total, add, remove, updateQty, clear }),
    [items, count, total, add, remove, updateQty, clear]
  );

  return (
    <ToastContext.Provider value={toastValue}>
      <AddressContext.Provider value={{ address, saveAddress }}>
        <AuthContext.Provider value={authValue}>
          <CartContext.Provider value={cartValue}>
            <CursorGlow />
            <ScrollProgress />
            <div className="grain" aria-hidden />
            {children}
            <ToastViewport items={toasts} />
          </CartContext.Provider>
        </AuthContext.Provider>
      </AddressContext.Provider>
    </ToastContext.Provider>
  );
}
