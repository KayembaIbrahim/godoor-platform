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
  setRole: (role: Role) => void;
  setProfile: (patch: Partial<OnboardingData>) => void;
  completeOnboarding: () => void;
  reset: () => void;
  signUp: (email: string, password: string, name: string, role: Role) => Promise<AuthResult>;
  signIn: (email: string, password: string, roleOverride?: Role) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  loadAuthSession: () => Promise<void>;
};

const initial: Pick<SessionState, "role" | "profile" | "onboarded" | "supabaseUser"> = {
  role: null,
  profile: {},
  onboarded: false,
  supabaseUser: null,
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
        if (!sb) return;
        try {
          // getUser() validates against the server and returns fresh metadata,
          // so fields like the phone (updated by an admin-approved request) appear.
          const { data: freshUser, error } = await sb.auth.getUser();
          const { data: sessionData } = await sb.auth.getSession();
          const user = (freshUser?.user || sessionData?.session?.user) && !error
            ? (freshUser?.user || sessionData?.session?.user)!
            : sessionData?.session?.user;
          if (user) {
            const existingRole = get().role;
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
              role: existingRole || (meta.role as Role) || "customer",
              onboarded: true,
            });
          }
        } catch {
          // Session expired or invalid — clear gracefully
        }
      },

      signUp: async (email, password, name, role) => {
        const sb = getSupabase();
        if (!sb) {
          set({
            supabaseUser: { id: "local_" + Date.now(), email },
            profile: { email, name, displayName: name, ...get().profile },
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
            body: JSON.stringify({ email, password, name, role }),
          });
          const result = await res.json();

          if (!res.ok && !result.alreadyExists) {
            return friendlyError(result.error || "Signup failed");
          }

          // Now sign in with the confirmed account
          const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({ email, password });
          if (signInErr) {
            return friendlyError(signInErr.message);
          }

          const user = signInData.user;
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

      signIn: async (email, password, roleOverride?: Role) => {
        const sb = getSupabase();
        if (!sb) return { error: "Supabase not configured." };

        try {
          const { data, error } = await sb.auth.signInWithPassword({ email, password });
          if (error) return friendlyError(error.message);

          const user = data.user;
          const resolvedRole = roleOverride || (user.user_metadata?.role as Role) || get().role || "customer";
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
          return {};
        } catch (e: any) {
          return friendlyError(e?.message || "Something went wrong. Try again.");
        }
      },

      signOut: async () => {
        const sb = getSupabase();
        if (sb) await sb.auth.signOut();
        set({ ...initial });
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
