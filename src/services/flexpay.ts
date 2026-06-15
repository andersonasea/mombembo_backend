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

function isV5Api(baseUrl: string) {
  return /gofreshbakery\.net\/api\/v5/i.test(baseUrl) || /\/api\/v5\/?$/i.test(baseUrl);
}

export function normalizeFlexpayPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.startsWith("243")) return digits;
  if (digits.startsWith("0")) return `243${digits.slice(1)}`;
  return `243${digits}`;
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
  if (isV5Api(baseUrl)) {
    return baseUrl.replace(/\/?$/, `/${encodeURIComponent(reference)}`);
  }
  if (baseUrl.includes("/gateway")) {
    return baseUrl.replace(/\/gateway\/?$/, `/check/${encodeURIComponent(reference)}`);
  }
  return `${baseUrl.replace(/\/$/, "")}/check/${encodeURIComponent(reference)}`;
}

export function resolveFlexpayCallbackUrl(publicApiBaseUrl?: string): string {
  const configured = process.env.FLEXPAY_CALLBACK_URL?.trim();
  if (configured && !configured.includes("localhost") && !configured.includes("127.0.0.1")) {
    return configured;
  }
  const apiBase = (publicApiBaseUrl ?? process.env.PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
  if (apiBase) {
    return `${apiBase}/api/payments/webhook/flexpay`;
  }
  return configured ?? "";
}

function getMethodMap(v5: boolean): Record<FlexpayPaymentMethod, string> {
  if (v5) {
    return {
      MPESA: "mpesa",
      AIRTEL_MONEY: "airtel",
      ORANGE_MONEY: "orange",
      AFRI_MONEY: "africell",
    };
  }
  return {
    MPESA: "mpesa",
    AIRTEL_MONEY: "airtelmoney",
    ORANGE_MONEY: "orangemoney",
    AFRI_MONEY: "afrimoney",
  };
}

function buildInitPayload(
  input: InitiateFlexpayPaymentInput,
  merchantId: string,
  merchantSecret: string,
  v5: boolean
) {
  const customerNumber = normalizeFlexpayPhoneNumber(input.phoneNumber);
  const shared = {
    merchant_id: merchantId,
    merchant_secrete: merchantSecret,
    amount: String(input.amount),
    currency: input.currency,
    action: "debit",
    customer_number: customerNumber,
    firstname: input.firstName,
    lastname: input.lastName,
    reference: input.reference,
    method: getMethodMap(v5)[input.method],
    callback_url: input.callbackUrl,
  };

  if (v5) {
    return {
      ...shared,
      "e-mail": input.email,
    };
  }

  return {
    ...shared,
    email: input.email,
  };
}

function parseInitResponse(
  raw: Record<string, unknown>,
  input: InitiateFlexpayPaymentInput,
  v5: boolean
): InitiateFlexpayPaymentResult {
  const providerReference = String(
    raw.Transaction_id ??
      raw.PayDRC_Reference ??
      raw.orderNumber ??
      raw.providerReference ??
      raw.transactionRef ??
      raw.Reference ??
      raw.reference ??
      input.reference
  );

  if (v5) {
    const transStatus = normalizeStatus(raw.Trans_Status);
    if (transStatus !== "PENDING") {
      return { providerReference, status: transStatus, raw };
    }
    const ackStatus = String(raw.Status ?? "").toLowerCase();
    if (ackStatus === "success" || ackStatus === "error") {
      if (ackStatus === "error" || normalizeProviderCode(raw.resultCode) === "FAILED") {
        const comment = String(raw.Comment ?? raw.resultCodeErrorDescription ?? "Paiement rejeté par FlexPay");
        throw new Error(`FLEXPAY_INIT_FAILED:400:${JSON.stringify({ message: comment, raw })}`);
      }
      return { providerReference, status: "PENDING", raw };
    }
  }

  const explicitStatus = normalizeStatus(raw.status ?? raw.paymentStatus ?? raw.Status);
  const initAccepted =
    normalizeProviderCode(raw.code) === "SUCCESS" &&
    explicitStatus === "PENDING" &&
    !raw.status &&
    !raw.paymentStatus &&
    !raw.Status;

  return {
    providerReference,
    status: initAccepted ? "PENDING" : explicitStatus,
    raw,
  };
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
        payload.Reference,
        payload.orderNumber,
        payload.order_number,
        payload.yourReference,
        payload.your_reference,
        payload.PayDRC_Reference,
        payload.Transaction_id,
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
  const transStatus = normalizeStatus(payload.Trans_Status ?? payload.trans_status);
  if (transStatus !== "PENDING") return transStatus;

  const fromCode =
    normalizeProviderCode(payload.code) ??
    normalizeProviderCode(payload.resultCode) ??
    normalizeProviderCode(payload.transactionCode) ??
    normalizeProviderCode(transaction.code) ??
    normalizeProviderCode(transaction.status);

  if (fromCode) return fromCode;

  return normalizeStatus(
    payload.status ??
      payload.Status ??
      payload.state ??
      payload.result ??
      transaction.status ??
      transaction.state
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

  const v5 = isV5Api(baseUrl);
  const payload = buildInitPayload(input, merchantId, merchantSecret, v5);
  const flexpayTimeoutMs = Number(process.env.FLEXPAY_REQUEST_TIMEOUT_MS ?? 30000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), flexpayTimeoutMs);

  let response: Response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
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

  console.log("FlexPay init response", {
    status: response.status,
    v5,
    reference: input.reference,
    raw,
  });

  if (!response.ok) {
    const details = JSON.stringify(raw);
    throw new Error(`FLEXPAY_INIT_FAILED:${response.status}:${details}`);
  }

  return parseInitResponse(raw, input, v5);
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

    const transStatus = normalizeStatus(raw.Trans_Status ?? raw.trans_status);
    if (transStatus !== "PENDING") {
      return { status: transStatus, raw };
    }

    const transaction = asRecord(raw.transaction);
    const fromCode =
      normalizeProviderCode(transaction.code) ??
      normalizeProviderCode(transaction.status) ??
      normalizeProviderCode(raw.transactionCode) ??
      normalizeProviderCode(raw.resultCode) ??
      normalizeProviderCode(raw.code);

    const status = fromCode ?? normalizeStatus(raw.status ?? raw.Status ?? transaction.status ?? transaction.state);
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
        headers.get("x-signature") ??
        headers.get("authorization")
      : String(
          (headers["x-flexpay-secret"] as string | undefined) ??
            (headers["x-callback-secret"] as string | undefined) ??
            (headers["x-signature"] as string | undefined) ??
            (headers["authorization"] as string | undefined) ??
            ""
        );

  return headerValue === expected || headerValue === `Bearer ${expected}`;
}
