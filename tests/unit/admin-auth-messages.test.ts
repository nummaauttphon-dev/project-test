import { describe, expect, it } from "vitest";
import { ADMIN_MESSAGES, loginFailure, mfaFailure } from "@/features/admin/auth-messages";

describe("loginFailure", () => {
  it.each([
    { status: 400, code: "invalid_credentials" },
    { status: 400, code: "email_not_confirmed" },
    { status: 400, code: "user_banned" },
    { status: 404, code: "user_not_found" },
    { status: 422, code: "validation_failed" },
  ])("uses one generic message for $code", (error) => {
    expect(loginFailure(error)).toEqual({ code: "INVALID_CREDENTIALS", message: ADMIN_MESSAGES.LOGIN_FAILED });
  });

  it.each([
    { status: 429, code: "over_request_rate_limit" },
    { status: 429 },
    { status: 400, code: "over_request_rate_limit" },
  ])("maps rate limits to Thai text: %o", (error) => {
    expect(loginFailure(error)).toEqual({ code: "RATE_LIMITED", message: ADMIN_MESSAGES.RATE_LIMITED });
  });

  it.each([{ status: 500 }, { status: 503 }, { status: 0 }, {}])("maps service failures: %o", (error) => {
    expect(loginFailure(error)).toEqual({ code: "SERVICE_UNAVAILABLE", message: ADMIN_MESSAGES.SERVICE_UNAVAILABLE });
  });
});

describe("mfaFailure", () => {
  it.each([
    { status: 422, code: "mfa_verification_failed" },
    { status: 422, code: "mfa_challenge_expired" },
    { status: 404, code: "mfa_factor_not_found" },
  ])("uses the wrong-code message for $code", (error) => {
    expect(mfaFailure(error)).toEqual({ code: "INVALID_CODE", message: ADMIN_MESSAGES.MFA_INVALID_CODE });
  });

  it("maps rate limits and service failures", () => {
    expect(mfaFailure({ status: 429 }).code).toBe("RATE_LIMITED");
    expect(mfaFailure({ status: 503 }).code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("messages", () => {
  it("are Thai", () => {
    for (const message of Object.values(ADMIN_MESSAGES)) expect(message).toMatch(/[฀-๿]/);
  });
});
