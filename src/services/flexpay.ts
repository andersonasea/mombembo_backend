type FlexpayPaymentMethod = "MPESA" | "AIRTEL_MONEY" | "ORANGE_MONEY" | "AFRI_MONEY";

type FlexpayPaymentStatus = "PENDING" | "SUCCESS" | "FAILED";

type InitiateFlexpayPaymentInput = {
  amount: number;
  currency: string;
  phoneNumber: string;
  method: FlexpayPaymentMethod;
  reference: string;
  firstName: string;
  lastName: string;
  email: string;
  callbackUrl: string;
};

type InitiateFlexpayPaymentResult = {
  providerReference: string;
  status: FlexpayPaymentStatus;
  raw: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeStatus(value: unknown): FlexpayPaymentStatus {
  const normalized = String(value ?? "").toUpperCase();
  if (["SUCCESS", "SUCCEEDED", "PAID", "COMPLETED", "APPROVED"].includes(normalized)) {
    return "SUCCESS";
  }
  if (["FAILED", "FAIL", "CANCELLED", "CANCELED", "REJECTED", "ERROR", "DECLINED"].includes(normalized)) {
    return "FAILED";
  }
  return "PENDING";
}

function normalizeProviderCode(value: unknown): FlexpayPaymentStatus | null {
  if (value === 0 || value === "0") return "SUCCESS";
  if (value === 1 || value === "1") return "FAILED";
  return null;
}

function resolveCheckUrl(reference: string): string {
  const template = process.env.FLEXPAY_CHECK_URL;
  if (template) {
    return template.replace("{reference}", encodeURIComponent(reference));
  }

  const baseUrl = process.env.FLEXPAY_BASE_URL ?? "";
  if (baseUrl.includes("/gateway")) {
    return baseUrl.replace(/\/gateway\/?$/, `/check/${encodeURIComponent(reference)}`);
  }
  return `${baseUrl.replace(/\/$/, "")}/check/${encodeURIComponent(reference)}`;
}

export function isFlexpayConfigured() {
  const baseUrl = process.env.FLEXPAY_BASE_URL ?? "";
  return Boolean(
    baseUrl &&
      !baseUrl.includes("TON_ENDPOINT") &&
      process.env.FLEXPAY_MERCHANT_ID &&
      process.env.FLEXPAY_MERCHANT_SECRET
  );
}

export function extractFlexpayReferences(payload: Record<string, unknown>): string[] {
  const transaction = asRecord(payload.transaction);
  return Array.from(
    new Set(
      [
        payload.providerReference,
        payload.transactionRef,
        payload.reference,
        payload.orderNumber,
        payload.order_number,
        payload.yourReference,
        payload.your_reference,
        transaction.reference,
        transaction.orderNumber,
      ]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
}

export function resolveFlexpayWebhookStatus(payload: Record<string, unknown>): FlexpayPaymentStatus {
  const transaction = asRecord(payload.transaction);
  const fromCode =
    normalizeProviderCode(payload.code) ??
    normalizeProviderCode(payload.transactionCode) ??
    normalizeProviderCode(transaction.code) ??
    normalizeProviderCode(transaction.status);

  if (fromCode) return fromCode;

  return normalizeStatus(
    payload.status ?? payload.state ?? payload.result ?? transaction.status ?? transaction.state
  );
}

export async function initiateFlexpayPayment(
  input: InitiateFlexpayPaymentInput
): Promise<InitiateFlexpayPaymentResult> {
  const baseUrl = process.env.FLEXPAY_BASE_URL;
  const merchantId = process.env.FLEXPAY_MERCHANT_ID;
  const merchantSecret = process.env.FLEXPAY_MERCHANT_SECRET;

  if (!baseUrl || !merchantId || !merchantSecret) {
    throw new Error("FLEXPAY_NOT_CONFIGURED");
  }

  const methodMap: Record<FlexpayPaymentMethod, string> = {
    MPESA: "mpesa",
    AIRTEL_MONEY: "airtelmoney",
    ORANGE_MONEY: "orangemoney",
    AFRI_MONEY: "afrimoney",
  };

  const payload = {
    merchant_id: merchantId,
    merchant_secrete: merchantSecret,
    amount: String(input.amount),
    currency: input.currency,
    action: "debit",
    customer_number: input.phoneNumber,
    firstname: input.firstName,
    lastname: input.lastName,
    email: input.email,
    reference: input.reference,
    method: methodMap[input.method],
    callback_url: input.callbackUrl,
  };

  const flexpayTimeoutMs = Number(process.env.FLEXPAY_REQUEST_TIMEOUT_MS ?? 30000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), flexpayTimeoutMs);

  let response: Response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("FLEXPAY_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = contentType.includes("application/json")
    ? ((await response.json().catch(() => ({}))) as Record<string, unknown>)
    : ({ message: await response.text().catch(() => "") } as Record<string, unknown>);
  if (!response.ok) {
    const details = JSON.stringify(raw);
    throw new Error(`FLEXPAY_INIT_FAILED:${response.status}:${details}`);
  }

  const providerReference = String(
    raw.orderNumber ??
      raw.providerReference ??
      raw.transactionRef ??
      raw.reference ??
      input.reference
  );

  const explicitStatus = normalizeStatus(raw.status ?? raw.paymentStatus);
  const initAccepted =
    normalizeProviderCode(raw.code) === "SUCCESS" &&
    explicitStatus === "PENDING" &&
    !raw.status &&
    !raw.paymentStatus;

  return {
    providerReference,
    status: initAccepted ? "PENDING" : explicitStatus,
    raw,
  };
}

export async function checkFlexpayPaymentStatus(
  reference: string
): Promise<{ status: FlexpayPaymentStatus; raw: unknown }> {
  if (!isFlexpayConfigured()) {
    return { status: "PENDING", raw: null };
  }

  const checkUrl = resolveCheckUrl(reference);
  const flexpayTimeoutMs = Number(process.env.FLEXPAY_REQUEST_TIMEOUT_MS ?? 30000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), flexpayTimeoutMs);

  try {
    const response = await fetch(checkUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    const raw = contentType.includes("application/json")
      ? ((await response.json().catch(() => ({}))) as Record<string, unknown>)
      : ({ message: await response.text().catch(() => "") } as Record<string, unknown>);

    if (!response.ok) {
      return { status: "PENDING", raw };
    }

    const transaction = asRecord(raw.transaction);
    const fromCode =
      normalizeProviderCode(transaction.code) ??
      normalizeProviderCode(transaction.status) ??
      normalizeProviderCode(raw.transactionCode) ??
      normalizeProviderCode(raw.code);

    const status = fromCode ?? normalizeStatus(raw.status ?? transaction.status ?? transaction.state);
    return { status, raw };
  } catch (error) {
    console.warn("FlexPay status check failed", {
      reference,
      checkUrl,
      error: error instanceof Error ? error.message : error,
    });
    return { status: "PENDING", raw: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function validateFlexpayWebhookSecret(headers: Headers | Record<string, unknown>) {
  const expected = process.env.FLEXPAY_WEBHOOK_SECRET;
  if (!expected) return true;

  const headerValue =
    headers instanceof Headers
      ? headers.get("x-flexpay-secret") ??
        headers.get("x-callback-secret") ??
        headers.get("authorization")
      : String(
          (headers["x-flexpay-secret"] as string | undefined) ??
            (headers["x-callback-secret"] as string | undefined) ??
            (headers["authorization"] as string | undefined) ??
            ""
        );

  return headerValue === expected || headerValue === `Bearer ${expected}`;
}
