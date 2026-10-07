"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getSupabase, IS_SUPABASE } from "./supabase";
import { requestNotificationPermission } from "./notifications-store";

/**
 * Clears the admin session cookie so switching between Godoor accounts
 * never silently keeps admin access on the same browser.
 */
function clearAdminSessionIfSwitched(prevUserId?: string, nextUserId?: string) {
  if (prevUserId && prevUserId !== nextUserId) {
    fetch("/api/admin/auth", { method: "DELETE" }).catch(() => {});
  }
}

export type Role = "customer" | "business" | "rider" | "admin";

export type OnboardingData = {
  email?: string;
  name?: string;          // Real legal name — set once at signup, never editable
  displayName?: string;   // Public display name — editable (max 2x per year)
  phone?: string;
  displayNameChanges?: number[];  // Timestamps of display name changes (for 2x/year limit)
  addresses?: { label: string; address: string; lat: number; lng: number }[];
  businessName?: string;
  category?: string;
  businessType?: "goods" | "clinic";
  tagline?: string;
  area?: string;
  district?: string;
  opensAt?: string;
  closesAt?: string;
  businessLat?: number;
  businessLng?: number;
  momoNumber?: string;
  momoName?: string;
  vehicleType?: string;
  plate?: string;
  serviceArea?: string;
  availability?: "online" | "offline";
  avatarUrl?: string;
  storeLogoUrl?: string;
  mustChangePassword?: boolean;
  /** Morse wallet username — unique per GoDoor user, compulsory for every role. */
  morseTag?: string;
};

type AuthResult = { error?: string; hint?: string };

export type SessionState = {
  role: Role | null;
  profile: OnboardingData;
  onboarded: boolean;
  supabaseUser: { id: string; email: string } | null;
  /* True once loadAuthSession has finished — i.e. "we now know whether there
     is a signed-in user", as opposed to `supabaseUser` being null merely
     because Supabase has not read localStorage yet. The two were conflated, so
     any screen that fetched on mount fired its request before the session
     existed, got a 401, and told a perfectly signed-in rider they were
     signed out. */
  authReady: boolean;
  setRole: (role: Role) => void;
  setProfile: (patch: Partial<OnboardingData>) => void;
  completeOnboarding: () => void;
  reset: () => void;
  signUp: (email: string, password: string, name: string, role: Role) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult & { role?: Role }>;
  signOut: () => Promise<void>;
  loadAuthSession: () => Promise<void>;
};

const initial: Pick<SessionState, "role" | "profile" | "onboarded" | "supabaseUser" | "authReady"> = {
  role: null,
  profile: {},
  onboarded: false,
  supabaseUser: null,
  authReady: false,
};

/** Friendly error messages for Supabase auth errors */
function friendlyError(msg: string): AuthResult {
  const m = msg.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many") || m.includes("email rate")) {
    return { error: "Too many attempts. Please wait a minute and try again.", hint: "rate_limited" };
  }
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("user already")) {
    return { error: "This email is already registered.", hint: "already_registered" };
  }
  if (m.includes("invalid login credentials") || m.includes("invalid") && m.includes("credential")) {
    return { error: "Wrong email or password.", hint: "wrong_credentials" };
  }
  if (m.includes("email not confirmed") || m.includes("not confirmed")) {
    return { error: "Please confirm your email first. Check your inbox.", hint: "not_confirmed" };
  }
  if (m.includes("password")) {
    return { error: "Password must be at least 6 characters.", hint: "weak_password" };
  }
  return { error: msg };
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      ...initial,
      setRole: (role) => set({ role }),
      setProfile: (patch) => set((s) => ({ profile: { ...s.profile, ...patch } })),
      completeOnboarding: () => set({ onboarded: true }),
      reset: () => {
        set({ ...initial });
        const sb = getSupabase();
        sb?.auth.signOut();
      },

      loadAuthSession: async () => {
        const sb = getSupabase();
        if (!sb) {
          set({ authReady: true });
          return;
        }
        try {
          // getUser() validates against the server and returns fresh metadata,
          // so fields like the phone (updated by an admin-approved request) appear.
          const { data: freshUser, error } = await sb.auth.getUser();
          const { data: sessionData } = await sb.auth.getSession();
          const user = (freshUser?.user || sessionData?.session?.user) && !error
            ? (freshUser?.user || sessionData?.session?.user)!
            : sessionData?.session?.user;
          if (user) {
            const prevUserId = get().supabaseUser?.id;
            const freshProfile = prevUserId && prevUserId !== user.id
              ? {} // different account on this device → never leak another user's profile
              : { ...get().profile };
            const meta = user.user_metadata || {};
            clearAdminSessionIfSwitched(prevUserId, user.id);
            // Sync morse_tag from the profiles table — the DB is the source
            // of truth and may differ from stale auth metadata (e.g. a
            // successful upsert where the metadata mirror failed silently).
            let profileMorseTag = get().profile.morseTag || (meta.morse_tag as string) || "";
            try {
              const { data: profRow } = await sb
                .from("profiles")
                .select("morse_tag")
                .eq("id", user.id)
                .maybeSingle();
              const dbTag = String((profRow as { morse_tag?: string | null } | null)?.morse_tag || "").trim();
              if (dbTag) profileMorseTag = dbTag;
            } catch {}

            set({
              supabaseUser: { id: user.id, email: user.email || "" },
              profile: {
                ...freshProfile,
                email: user.email || freshProfile.email,
                name: (meta.name as string) || get().profile.name,
                displayName: get().profile.displayName || (meta.display_name as string) || (meta.name as string) || get().profile.name,
                phone: (meta.phone as string) || get().profile.phone || "",
                avatarUrl: get().profile.avatarUrl || (meta.avatar as string) || "",
                morseTag: profileMorseTag,
                mustChangePassword: meta.must_change_password === true,
              },
              // The server is the only authority on role. The persisted value
              // used to win here, which meant a stale role — left behind by the
              // old login role-picker or by the pre-auth onboarding picker —
              // permanently overrode the real one, so riders were dropped into
              // the customer/business UI on every page load.
              role: (meta.role as Role) || "customer",
              onboarded: true,
            });
          }
        } catch {
          // Session expired or invalid — clear gracefully
        } finally {
          // Always flip the flag, including when getUser()/getSession() threw.
          // Without this, a network hiccup during boot left authReady false for
          // the life of the page and every gated fetch waited forever.
          set({ authReady: true });
        }
      },

      signUp: async (email, password, name, role) => {
        const sb = getSupabase();
        // Keep the stored address in the same normalised form the sign-in path
        // uses, so an account created as "User@x.com" is reachable afterwards.
        const mail = email.trim().toLowerCase();
        if (!sb) {
          set({
            supabaseUser: { id: "local_" + Date.now(), email: mail },
            profile: { email: mail, name, displayName: name, ...get().profile },
            role,
            onboarded: true,
          });
          return {};
        }

        try {
          // Use our API route for signup — auto-confirms email, no rate limits
          const res = await fetch("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: mail, password, name, role }),
          });
          const result = await res.json();

          if (!res.ok && !result.alreadyExists) {
            return friendlyError(result.error || "Signup failed");
          }

          // Now sign in with the confirmed account
          const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({ email: mail, password });
          if (signInErr) {
            return friendlyError(signInErr.message);
          }

          const user = signInData.user;
          const prevUserId = get().supabaseUser?.id;
          const freshProfile = prevUserId && prevUserId !== user.id ? {} : { ...get().profile };
          clearAdminSessionIfSwitched(prevUserId, user.id);
set({
              supabaseUser: { id: user.id, email: user.email || mail },
              profile: {
                ...freshProfile,
                email: user.email || mail,
                name: (user.user_metadata?.name as string) || get().profile.name,
                displayName: get().profile.displayName || (user.user_metadata?.display_name as string) || (user.user_metadata?.name as string) || get().profile.name,
                phone: (user.user_metadata?.phone as string) || get().profile.phone || "",
              },
              role: (user.user_metadata?.role as Role) || role,
              onboarded: true,
            });
          requestNotificationPermission();
          return {};
        } catch (e: any) {
          return friendlyError(e?.message || "Something went wrong. Try again.");
        }
      },

      signIn: async (email, password) => {
        const sb = getSupabase();
        if (!sb) return { error: "Supabase not configured." };

        try {
          // An untrimmed/mixed-case address is rejected by Supabase exactly like
          // a wrong password, so a stray space or a capital letter read as
          // "no such account". Normalise before sending.
          const { data, error } = await sb.auth.signInWithPassword({
            email: email.trim().toLowerCase(),
            password,
          });
          if (error) return friendlyError(error.message);

          const user = data.user;
          // Role is server-authoritative. Taking it from client input or from the
          // role persisted on this device would let any account sign in as any
          // role, so only the verified account metadata is trusted here.
          const resolvedRole = (user.user_metadata?.role as Role) || "customer";
          const prevUserId = get().supabaseUser?.id;
          const freshProfile = prevUserId && prevUserId !== user.id ? {} : { ...get().profile };
          clearAdminSessionIfSwitched(prevUserId, user.id);
          set({
            supabaseUser: { id: user.id, email: user.email || email },
            profile: {
              ...freshProfile,
              email: user.email || email,
              name: (user.user_metadata?.name as string) || get().profile.name,
              displayName: get().profile.displayName || (user.user_metadata?.display_name as string) || (user.user_metadata?.name as string) || get().profile.name,
              phone: (user.user_metadata?.phone as string) || get().profile.phone || "",
              mustChangePassword: user.user_metadata?.must_change_password === true,
            },
            role: resolvedRole,
            onboarded: true,
          });
          requestNotificationPermission();
          return { role: resolvedRole };
        } catch (e: any) {
          return friendlyError(e?.message || "Something went wrong. Try again.");
        }
      },

      signOut: async () => {
        const sb = getSupabase();
        if (sb) await sb.auth.signOut();
        // `initial` carries authReady:false, but a completed sign-out is a
        // *resolved* auth state — leaving it false would stall every gated
        // fetch behind a session load that is never coming.
        set({ ...initial, authReady: true });
      },
    }),
    { name: "godoor-session" },
  ),
);

export const isRealAuth = () => IS_SUPABASE;

/** Where each role should land after sign-in / onboarding. */
export function roleHomePath(role: Role | null | undefined): string {
  switch (role) {
    case "business": return "/business";
    case "rider": return "/rider";
    case "admin": return "/admin";
    default: return "/app";
  }
}
