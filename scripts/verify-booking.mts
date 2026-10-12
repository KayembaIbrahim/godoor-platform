/**
 * Table-booking logic tests.
 *
 * Imports the REAL functions from src/lib/booking.ts. Booking math that only
 * ever gets exercised by a copy of itself is not tested.
 */

import assert from "node:assert/strict";
import {
  parseHhMm,
  formatHhMm,
  buildSlots,
  availableSlots,
  validateBooking,
  resolveBookingConfig,
  bookingDeposit,
  seatsBySlot,
  kampalaDate,
  addDays,
  newBookingId,
  bookingReference,
  DEFAULT_BOOKING_CONFIG,
  type BookingRecord,
} from "../src/lib/booking.ts";

let pass = 0;
let fail = 0;

function t(name: string, fn: () => void) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${(e as Error).message.split("\n")[0]}`);
  }
}

const CFG = { ...DEFAULT_BOOKING_CONFIG, enabled: true, minNoticeMinutes: 60, advanceDays: 30, maxGuests: 20 };

/* ---------------------------- time parsing ---------------------------- */

t("parseHhMm handles normal times", () => {
  assert.equal(parseHhMm("18:30"), 18 * 60 + 30);
  assert.equal(parseHhMm("08:00"), 480);
  assert.equal(parseHhMm(" 22:00 "), 1320);
});

t("parseHhMm rejects garbage", () => {
  for (const bad of ["", "25:00", "12:60", "1230", "noon", null, undefined, 18.5, {}]) {
    assert.equal(parseHhMm(bad as unknown), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

t("formatHhMm pads and round-trips", () => {
  assert.equal(formatHhMm(0), "00:00");
  assert.equal(formatHhMm(485), "08:05");
  assert.equal(parseHhMm(formatHhMm(1290)), 1290);
});

/* ---------------------------- slot building ---------------------------- */

t("buildSlots steps from open to close", () => {
  const slots = buildSlots({ opensAt: "17:00", closesAt: "20:00" }, { date: "2030-01-01" });
  assert.deepEqual(slots, ["17:00", "17:30", "18:00", "18:30", "19:00", "19:30"]);
});

t("buildSlots lets the last seating finish before closing", () => {
  // 30-min slots, closes 22:00 → last seating 21:30, never 22:00.
  const slots = buildSlots({ opensAt: "20:00", closesAt: "22:00" }, { date: "2030-01-01" });
  assert.equal(slots[slots.length - 1], "21:30");
  assert.ok(!slots.includes("22:00"));
});

t("buildSlots honours a custom duration", () => {
  const slots = buildSlots(
    { opensAt: "12:00", closesAt: "15:00", durationMinutes: 60 },
    { date: "2030-01-01" },
  );
  assert.deepEqual(slots, ["12:00", "13:00", "14:00"]);
});

t("buildSlots falls back to dinner hours when unset", () => {
  const slots = buildSlots({ opensAt: null, closesAt: null }, { date: "2030-01-01" });
  assert.equal(slots[0], "17:00");
  assert.equal(slots[slots.length - 1], "21:30");
});

t("buildSlots survives closing before opening rather than looping forever", () => {
  // Would be an infinite loop if the guard were `open <= close`.
  const slots = buildSlots({ opensAt: "22:00", closesAt: "09:00" }, { date: "2030-01-01" });
  assert.ok(Array.isArray(slots));
  assert.ok(slots.length < 40, `expected a short list, got ${slots.length}`);
});

t("buildSlots handles a midnight-closing restaurant", () => {
  const slots = buildSlots({ opensAt: "18:00", closesAt: "23:30" }, { date: "2030-01-01" });
  assert.ok(slots.includes("23:00"));
  assert.ok(!slots.includes("23:30"));
});

/* ---------------------------- availability ---------------------------- */

t("availableSlots drops a past date", () => {
  const now = new Date("2030-06-15T10:00:00Z");
  const out = availableSlots({ opensAt: "17:00", closesAt: "22:00" }, { date: "2020-01-01", now });
  assert.deepEqual(out, []);
});

t("availableSlots drops slots inside the notice window today", () => {
  // 10:00 UTC = 13:00 Kampala. With 60min notice, 13:00 is out, 15:00 is in.
  const now = new Date("2030-06-15T10:00:00Z");
  const out = availableSlots(
    { opensAt: "12:00", closesAt: "20:00" },
    { date: kampalaDate(now), now, minNoticeMinutes: 60 },
  );
  assert.ok(!out.includes("13:00"), "13:00 is inside the notice window");
  assert.ok(out.includes("15:00"), "15:00 clears the notice window");
});

t("availableSlots drops a slot at or past capacity", () => {
  const out = availableSlots(
    { opensAt: "17:00", closesAt: "20:00" },
    { date: "2030-01-01", seatsTaken: { "18:00": 20 }, capacity: 20 },
  );
  assert.ok(!out.includes("18:00"));
  assert.ok(out.includes("18:30"));
});

t("availableSlots keeps a slot with a seat left", () => {
  const out = availableSlots(
    { opensAt: "17:00", closesAt: "20:00" },
    { date: "2030-01-01", seatsTaken: { "18:00": 19 }, capacity: 20 },
  );
  assert.ok(out.includes("18:00"));
});

/* ---------------------------- validation ---------------------------- */

const FUTURE = addDays(kampalaDate(new Date("2029-12-01T10:00:00Z")), 10); // inside the 30-day window
const WIN = { opensAt: "17:00", closesAt: "22:00" };
const SLOTS = buildSlots(WIN, { date: FUTURE });
const NOW = new Date("2029-12-01T10:00:00Z");

function v(over: Partial<Parameters<typeof validateBooking>[0]>) {
  return validateBooking({
    merchantName: "Zains Grill",
    date: FUTURE,
    time: "18:00",
    guests: 2,
    slots: SLOTS,
    now: NOW,
    cfg: CFG,
    ...over,
  });
}

t("validateBooking accepts a good booking", () => {
  assert.equal(v({}), null);
});

t("validateBooking requires a restaurant", () => {
  assert.match(v({ merchantName: "" }) ?? "", /restaurant/i);
});

t("validateBooking rejects a past date", () => {
  assert.match(v({ date: "2020-01-01" }) ?? "", /passed/i);
});

t("validateBooking rejects a malformed date", () => {
  assert.ok(v({ date: "01-01-2030" }));
  assert.ok(v({ date: "2030/01/01" }));
});

t("validateBooking rejects a date beyond the advance window", () => {
  assert.match(v({ date: addDays(kampalaDate(NOW), 31) }) ?? "", /30 days/);
});

t("validateBooking accepts a date exactly at the advance limit", () => {
  assert.equal(v({ date: addDays(kampalaDate(NOW), 30) }), null);
});

t("validateBooking rejects a time that is not on the menu", () => {
  assert.match(v({ time: "03:30" }) ?? "", /no longer available/i);
});

t("validateBooking rejects a malformed time", () => {
  assert.ok(v({ time: "1800" }));
});

t("validateBooking enforces the guest floor", () => {
  assert.match(v({ guests: 0 }) ?? "", /at least one/i);
  assert.match(v({ guests: -3 }) ?? "", /at least one/i);
  assert.ok(v({ guests: 999 }));
});

t("validateBooking enforces the guest ceiling", () => {
  assert.match(v({ guests: CFG.maxGuests + 1 }) ?? "", /limited to/);
  assert.equal(v({ guests: CFG.maxGuests }), null);
});

t("validateBooking applies notice on today only", () => {
  // NOW is 10:00 UTC = 13:00 Kampala. Use a lunch service so the slots under
  // test actually exist on the menu (a 17:00-open restaurant has no 13:00).
  const today = kampalaDate(NOW);
  const lunch = { opensAt: "12:00", closesAt: "20:00" };
  const todaySlots = buildSlots(lunch, { date: today });
  const call = (time: string) =>
    validateBooking({ merchantName: "X", date: today, time, guests: 2, slots: todaySlots, now: NOW, cfg: CFG });

  assert.match(call("13:00") ?? "", /notice/i, "13:00 is inside the 60min notice window");
  assert.match(call("14:00") ?? "", /notice/i, "14:00 is exactly at the cut-off, so still too soon");
  assert.equal(call("15:00"), null, "15:00 clears the notice window");
  assert.equal(v({ date: FUTURE }), null, "a future date carries no notice rule");
});

t("notice window is measured in Kampala, not UTC", () => {
  // 14:00 UTC is 17:00 Kampala. With a 0-minute notice the cut-off is the
  // current Kampala minute (17:00), so a 17:00 seating is too late and 17:30
  // is fine. A UTC clock would compute a 14:00 cut-off and wrongly allow
  // 17:00 — that is exactly the bug this asserts against.
  const now = new Date("2030-06-15T14:00:00Z");
  const today = kampalaDate(now);
  const slots = buildSlots({ opensAt: "12:00", closesAt: "20:00" }, { date: today });
  const cfg0 = { ...CFG, minNoticeMinutes: 0 };
  const call = (time: string) =>
    validateBooking({ merchantName: "X", date: today, time, guests: 2, slots, now, cfg: cfg0 });

  assert.match(call("17:00") ?? "", /notice/i, "17:00 Kampala is the cut-off, so it is too late");
  assert.equal(call("17:30"), null, "17:30 Kampala clears the cut-off");
});

/* ---------------------------- config ---------------------------- */

t("resolveBookingConfig falls back safely", () => {
  const c = resolveBookingConfig(null);
  assert.equal(c.maxGuests, DEFAULT_BOOKING_CONFIG.maxGuests);
  assert.equal(c.enabled, DEFAULT_BOOKING_CONFIG.enabled);
});

t("resolveBookingConfig clamps hostile values", () => {
  const c = resolveBookingConfig({ maxGuests: 1e9, advanceDays: -5, depositPerGuestUgx: -100 });
  assert.ok(c.maxGuests <= 100, "guest ceiling is clamped");
  assert.ok(c.advanceDays >= 1, "advance days is clamped");
  assert.equal(c.depositPerGuestUgx, 0);
});

t("resolveBookingConfig coerces strings", () => {
  const c = resolveBookingConfig({ maxGuests: "8" });
  assert.equal(c.maxGuests, 8);
});

t("bookingDeposit is guests x rate and never negative", () => {
  assert.equal(bookingDeposit(4, { ...CFG, depositPerGuestUgx: 5000 }), 20_000);
  assert.equal(bookingDeposit(0, { ...CFG, depositPerGuestUgx: 5000 }), 0);
  assert.equal(bookingDeposit(-5, { ...CFG, depositPerGuestUgx: 5000 }), 0);
});

t("booking ships with a free reservation by default", () => {
  assert.equal(DEFAULT_BOOKING_CONFIG.depositPerGuestUgx, 0);
  assert.equal(DEFAULT_BOOKING_CONFIG.enabled, false);
});

/* ---------------------------- seats ---------------------------- */

function rec(over: Partial<BookingRecord>): BookingRecord {
  return {
    id: "bk_1",
    merchantId: "m1",
    merchantName: "Zains Grill",
    userId: "u1",
    userName: "Ibrahim",
    userEmail: "i@example.com",
    date: "2030-01-01",
    time: "18:00",
    guests: 2,
    depositUgx: 0,
    status: "confirmed",
    note: "",
    createdAt: "2029-12-01T10:00:00.000Z",
    cancelledAt: null,
    ...over,
  };
}

t("seatsBySlot sums confirmed covers per slot", () => {
  const out = seatsBySlot(
    [rec({ id: "a", time: "18:00", guests: 2 }), rec({ id: "b", time: "18:00", guests: 3 }), rec({ id: "c", time: "19:00", guests: 4 })],
    "2030-01-01",
  );
  assert.equal(out["18:00"], 5);
  assert.equal(out["19:00"], 4);
});

t("seatsBySlot ignores cancelled bookings", () => {
  const out = seatsBySlot([rec({ id: "a", status: "cancelled", guests: 9 })], "2030-01-01");
  assert.equal(out["18:00"], undefined);
});

t("seatsBySlot ignores other dates", () => {
  const out = seatsBySlot([rec({ id: "a", date: "2030-02-02" })], "2030-01-01");
  assert.deepEqual(out, {});
});

/* ---------------------------- ids ---------------------------- */

t("booking ids are unique and reference-safe", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = newBookingId();
    assert.ok(!seen.has(id), "duplicate booking id");
    seen.add(id);
  }
  for (const id of seen) assert.match(bookingReference(id), /^GDR-[A-Z0-9]+$/);
});

t("kampalaDate is UTC+3", () => {
  // 22:30 UTC is already the next day in Kampala.
  assert.equal(kampalaDate(new Date("2030-01-01T22:30:00Z")), "2030-01-02");
  assert.equal(kampalaDate(new Date("2030-01-01T20:59:00Z")), "2030-01-01");
});

t("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2030-01-31", 1), "2030-02-01");
  assert.equal(addDays("2029-12-31", 1), "2030-01-01");
});

console.log(`\n  booking: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);