import { describe, expect, it } from "vitest";
import {
  applicationFeeAmount,
  applicationFeePercent,
  feePercentLabel,
  planForSubscriptionStatus,
  proPriceCents,
  shouldApplyPlatformSubscription,
} from "./fees";

const starter = { plan: "starter", platform_fee_bps: 300 };
const pro = { plan: "pro", platform_fee_bps: 300 };

describe("applicationFeeAmount", () => {
  it("takes platform_fee_bps of one-time payments on Starter", () => {
    expect(applicationFeeAmount(10_000, starter)).toBe(300);
    expect(applicationFeeAmount(9_000, starter)).toBe(270);
  });
  it("rounds half up to the nearest cent", () => {
    expect(applicationFeeAmount(1_250, starter)).toBe(38); // 37.5
    expect(applicationFeeAmount(1_249, starter)).toBe(37); // 37.47
    expect(applicationFeeAmount(4_999, { plan: "starter", platform_fee_bps: 250 })).toBe(125); // 124.975
  });
  it("charges nothing on Pro", () => {
    expect(applicationFeeAmount(10_000, pro)).toBeUndefined();
  });
  it("charges nothing for zero fees or zero amounts", () => {
    expect(applicationFeeAmount(10_000, { plan: "starter", platform_fee_bps: 0 })).toBeUndefined();
    expect(applicationFeeAmount(0, starter)).toBeUndefined();
    expect(applicationFeeAmount(10, starter)).toBeUndefined(); // 0.3 cents rounds to 0
  });
  it("never exceeds the amount", () => {
    expect(applicationFeeAmount(100, { plan: "starter", platform_fee_bps: 3000 })).toBe(30);
  });
});

describe("applicationFeePercent", () => {
  it("converts basis points to a percent for subscriptions", () => {
    expect(applicationFeePercent(starter)).toBe(3);
    expect(applicationFeePercent({ plan: "starter", platform_fee_bps: 275 })).toBe(2.75);
  });
  it("is undefined on Pro or with no fee", () => {
    expect(applicationFeePercent(pro)).toBeUndefined();
    expect(applicationFeePercent({ plan: "starter", platform_fee_bps: 0 })).toBeUndefined();
  });
  it("labels percentages", () => {
    expect(feePercentLabel(300)).toBe("3%");
    expect(feePercentLabel(275)).toBe("2.75%");
  });
});

describe("platform plan", () => {
  it("is Pro while the subscription is live (incl. dunning)", () => {
    expect(planForSubscriptionStatus("active")).toBe("pro");
    expect(planForSubscriptionStatus("trialing")).toBe("pro");
    expect(planForSubscriptionStatus("past_due")).toBe("pro");
  });
  it("is Starter otherwise", () => {
    for (const s of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused", null, undefined]) {
      expect(planForSubscriptionStatus(s)).toBe("starter");
    }
  });
  it("ignores an old subscription ending after a new one started", () => {
    const current = { platform_subscription_id: "sub_new", platform_subscription_status: "active" };
    expect(shouldApplyPlatformSubscription(current, { id: "sub_old", status: "canceled" })).toBe(false);
    expect(shouldApplyPlatformSubscription(current, { id: "sub_new", status: "canceled" })).toBe(true);
    expect(shouldApplyPlatformSubscription(current, { id: "sub_other", status: "active" })).toBe(true);
    expect(shouldApplyPlatformSubscription({ platform_subscription_id: null, platform_subscription_status: null }, { id: "s", status: "incomplete" })).toBe(true);
    expect(
      shouldApplyPlatformSubscription({ platform_subscription_id: "sub_old", platform_subscription_status: "canceled" }, { id: "sub_x", status: "incomplete" }),
    ).toBe(true);
  });
});

describe("proPriceCents", () => {
  it("reads PLATFORM_PRO_PRICE_DOLLARS with a $49 default", () => {
    expect(proPriceCents(undefined)).toBe(4900);
    expect(proPriceCents("79")).toBe(7900);
    expect(proPriceCents("49.99")).toBe(4999);
    expect(proPriceCents("$49")).toBe(4900);
    expect(proPriceCents("0")).toBe(4900);
  });
});
