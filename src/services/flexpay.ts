type FlexpayPaymentMethod = "MPESA" | "AIRTEL_MONEY" | "ORANGE_MONEY" | "AFRI_MONEY";

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
  status: "PENDING" | "SUCCESS" | "FAILED";
  raw: unknown;
};

function normalizeStatus(value: unknown): "PENDING" | "SUCCESS" | "FAILED" {
  const normalized = String(value ?? "").toUpperCase();
  if (["SUCCESS", "SUCCEEDED", "PAID", "COMPLETED"].includes(normalized)) return "SUCCESS";
  if (["FAILED", "FAIL", "CANCELLED", "CANCELED", "REJECTED", "ERROR"].includes(normalized)) return "FAILED";
  return "PENDING";
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

  const providerReference =
    String(raw.providerReference ?? raw.transactionRef ?? raw.reference ?? input.reference);

  return {
    providerReference,
    status: normalizeStatus(raw.status),
    raw,
  };
}

export function validateFlexpayWebhookSecret(headers: Headers | Record<string, unknown>) {
  const expected = process.env.FLEXPAY_WEBHOOK_SECRET;
  if (!expected) return true;

  const headerValue =
    headers instanceof Headers
      ? headers.get("x-flexpay-secret")
      : String((headers["x-flexpay-secret"] as string | undefined) ?? "");

  return headerValue === expected;
}
