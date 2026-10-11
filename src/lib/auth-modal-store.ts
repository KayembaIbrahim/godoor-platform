"use client";

import { create } from "zustand";

/**
 * One auth dialog, openable from anywhere.
 *
 * `HeaderAuth` used to own the modal in local state, which meant it could only
 * ever be opened by the button inside `HeaderAuth` itself. Every other place
 * that wanted a visitor to sign up — the hero, a promo banner, an empty cart —
 * would have had to render its own copy of the form, and a second form is a
 * second set of bugs (and a second place for the role/credential handling to
 * drift out of sync).
 *
 * So the dialog is a singleton the whole page can drive: any component calls
 * `openAuth("signup")`, and the single mounted `AuthModal` renders. Which form
 * it opens on is decided by the caller, because "Sign in to finish checkout"
 * and "Create your free account" want the opposite starting point.
 *
 * Deliberately NOT persisted — a reload should never re-open a dialog, and a
 * stale dialog on a page the customer navigated away from is worse than none.
 */
export type AuthMode = "login" | "signup";

type AuthModalState = {
  mode: AuthMode | null;
  /** Open the dialog, optionally choosing which form it starts on. */
  open: (mode?: AuthMode) => void;
  close: () => void;
};

export const useAuthModal = create<AuthModalState>()((set) => ({
  mode: null,
  open: (mode = "login") => set({ mode }),
  close: () => set({ mode: null }),
}));