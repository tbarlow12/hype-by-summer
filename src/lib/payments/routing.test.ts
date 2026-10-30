import { describe, expect, it } from "vitest";
import { CONNECT_EVENTS, PLATFORM_EVENTS, isPlatformPlanObject, routeEvent } from "./routing";

describe("routeEvent", () => {
  it("sends events with an account to that connected account's business", () => {
    expect(routeEvent({ type: "checkout.session.completed", account: "acct_123", data: { object: { object: "checkout.session" } } })).toEqual({
      scope: "connect",
      account: "acct_123",
    });
    expect(routeEvent({ type: "charge.refunded", account: "acct_9", data: { object: {} } })).toEqual({ scope: "connect", account: "acct_9" });
  });
  it("treats events without an account as platform events", () => {
    expect(routeEvent({ type: "customer.subscription.updated", account: null, data: { object: {} } })).toEqual({ scope: "platform", account: null });
    expect(routeEvent({ type: "invoice.paid", data: { object: {} } })).toEqual({ scope: "platform", account: null });
  });
  it("reads the connected account off application fees", () => {
    expect(routeEvent({ type: "application_fee.created", data: { object: { object: "application_fee", account: "acct_5" } } })).toEqual({
      scope: "platform",
      account: "acct_5",
    });
    expect(routeEvent({ type: "application_fee.refunded", data: { object: { account: { id: "acct_6" } } } })).toEqual({
      scope: "platform",
      account: "acct_6",
    });
  });
  it("routes account.updated delivered to the platform endpoint by the account id", () => {
    expect(routeEvent({ type: "account.updated", data: { object: { object: "account", id: "acct_7" } } })).toEqual({ scope: "connect", account: "acct_7" });
  });
});

describe("event lists", () => {
  it("covers onboarding, client money and platform billing", () => {
    expect(CONNECT_EVENTS).toContain("account.updated");
    expect(CONNECT_EVENTS).toContain("checkout.session.completed");
    expect(CONNECT_EVENTS).toContain("charge.refunded");
    expect(PLATFORM_EVENTS).toContain("application_fee.created");
    expect(PLATFORM_EVENTS).toContain("customer.subscription.deleted");
    expect(new Set(CONNECT_EVENTS).size).toBe(CONNECT_EVENTS.length);
  });
  it("recognises platform plan objects", () => {
    expect(isPlatformPlanObject({ kind: "platform_plan", business_id: "b" })).toBe(true);
    expect(isPlatformPlanObject({ kind: "package", business_id: "b" })).toBe(false);
    expect(isPlatformPlanObject(null)).toBe(false);
  });
});
