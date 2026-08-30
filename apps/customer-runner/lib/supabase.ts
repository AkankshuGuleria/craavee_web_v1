import "react-native-get-random-values";
import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import * as aesjs from "aes-js";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";

import type { Database } from "@craavee/types";

/**
 * Session storage — SECURITY_MODEL.md §3 / Phase 3 §5.
 *
 * Native (iOS/Android): `LargeSecureStore`, the pattern documented at
 * https://supabase.com/docs/reference/javascript/initializing (React
 * Native section). Expo's `SecureStore` (iOS Keychain / Android Keystore)
 * cannot hold values over 2048 bytes, which a Supabase session (access +
 * refresh token + user object) regularly exceeds — so a random AES-256 key
 * is generated per storage key and kept in SecureStore (small, encrypted
 * at rest by the OS), while the actual session JSON is AES-encrypted and
 * persisted in AsyncStorage (which has no size limit but is NOT itself
 * encrypted at rest — the encryption is what makes this "secure storage,"
 * not AsyncStorage's own guarantees, which are none). This is NOT "an
 * arbitrary custom JSON object in localStorage" (Phase 3 §5's explicit
 * prohibition) — the persisted value is ciphertext, unreadable without the
 * Keychain/Keystore-protected key.
 *
 * Web: falls back to `undefined` (the `storage` option), which makes
 * `@supabase/supabase-js` use its own default browser persistence
 * (`window.localStorage`) — the Supabase-supported browser mechanism
 * Phase 3 §5 calls for explicitly ("For web/PWA, use the Supabase-
 * supported browser persistence mechanism"). SecureStore has no web
 * implementation, so there is no more-secure native option to reach for
 * on this platform; a web session cookie/localStorage always trades off
 * against XSS the same way regardless of app-level choices here.
 */
class LargeSecureStore implements SupportedStorage {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1)
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return await this.decrypt(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }
}

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env.local (repo root or this app) and fill in " +
      "the local `supabase status` values — see README.md."
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === "web" ? undefined : new LargeSecureStore(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === "web",
  },
});

// React Native apps are backgrounded/foregrounded by the OS in a way
// browsers aren't — Supabase's token-refresh timer needs an explicit nudge
// tied to that lifecycle (documented pattern, `supabase.auth.
// startAutoRefresh()`/`stopAutoRefresh()`). Not needed on web: the
// browser tab's own visibility/timer behavior already does the right
// thing, and `AppState` isn't a meaningful concept there.
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
