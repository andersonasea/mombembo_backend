import crypto from "node:crypto";

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
  const normalized = String(value ?? "").toUpperCase().replace(/\s+/g, "_");
  if (
    ["SUCCESS", "SUCCEEDED", "SUCCESSFUL", "PAID", "COMPLETED", "APPROVED", "OK", "DONE"].includes(
      normalized
    ) ||
    (normalized.includes("SUCCESS") && !normalized.includes("UNSUCCESS"))
  ) {
    return "SUCCESS";
  }
  if (
    ["FAILED", "FAIL", "CANCELLED", "CANCELED", "REJECTED", "ERROR", "DECLINED"].includes(
      normalized
    ) ||
    normalized.includes("FAIL")
  ) {
    return "FAILED";
  }
  if (
    ["SUBMITTED", "PENDING", "PROCESSING", "IN_PROGRESS", "INITIATED", "QUEUED", "WAITING"].includes(
      normalized
    )
  ) {
    return "PENDING";
  }
  return "PENDING";
}

function resolveTransStatus(value: unknown): FlexpayPaymentStatus | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const normalized = normalizeStatus(text);
  const upper = text.toUpperCase().replace(/\s+/g, "_");
  if (normalized === "SUCCESS" || normalized === "FAILED") return normalized;
  if (
    ["SUBMITTED", "PENDING", "PROCESSING", "IN_PROGRESS", "INITIATED", "QUEUED", "WAITING"].includes(
      upper
    )
  ) {
    return "PENDING";
  }
  return null;
}

function isV1InitAcknowledgement(raw: Record<string, unknown>): boolean {
  const transStatusRaw = raw.Trans_Status ?? raw.trans_status;
  if (transStatusRaw != null && String(transStatusRaw).trim() !== "") {
    const resolved = resolveTransStatus(transStatusRaw);
    if (resolved === "SUCCESS" || resolved === "FAILED") return false;
  }

  const status = String(raw.Status ?? "").toLowerCase();
  const comment = String(raw.Comment ?? "").toLowerCase();
  const transStatus = String(raw.Trans_Status ?? raw.trans_status ?? "").toLowerCase();

  if (
    status === "success" &&
    (comment.includes("received") ||
      comment.includes("reçu") ||
      comment.includes("recu") ||
      comment.includes("transaction received"))
  ) {
    return true;
  }

  if (
    status === "success" &&
    ["submitted", "pending", "processing", "in_progress"].includes(transStatus)
  ) {
    return true;
  }

  return false;
}

function parseProviderStatus(raw: Record<string, unknown>): FlexpayPaymentStatus {
  const transStatusRaw = raw.Trans_Status ?? raw.trans_status;
  if (transStatusRaw != null && String(transStatusRaw).trim() !== "") {
    const resolved = resolveTransStatus(transStatusRaw);
    if (resolved === "SUCCESS" || resolved === "FAILED") return resolved;
  }

  const transaction = asRecord(raw.transaction);
  for (const field of [
    transaction.Trans_Status,
    transaction.trans_status,
    transaction.status,
    transaction.state,
    raw.Payment_Status,
    raw.payment_status,
  ]) {
    if (field == null || String(field).trim() === "") continue;
    const resolved = resolveTransStatus(field);
    if (resolved === "SUCCESS" || resolved === "FAILED") return resolved;
  }

  const fromCode =
    normalizeProviderCode(transaction.code) ??
    normalizeProviderCode(transaction.status) ??
    normalizeProviderCode(raw.transactionCode) ??
    normalizeProviderCode(raw.resultCode) ??
    normalizeProviderCode(raw.code);

  if (fromCode === "SUCCESS" || fromCode === "FAILED") return fromCode;

  if (isV1InitAcknowledgement(raw)) {
    return "PENDING";
  }

  return normalizeStatus(
    raw.status ?? raw.paymentStatus ?? raw.Status ?? raw.state ?? transaction.status ?? transaction.state
  );
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

  if (isV1InitAcknowledgement(raw)) {
    return { providerReference, status: "PENDING", raw };
  }

  if (parseProviderStatus(raw) === "FAILED") {
    return { providerReference, status: "FAILED", raw };
  }

  // Push payment: a successful init only sends the USSD prompt, not a completed debit.
  return { providerReference, status: "PENDING", raw };
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
  return parseProviderStatus(payload);
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

  const baseUrl = process.env.FLEXPAY_BASE_URL ?? "";
  const merchantId = process.env.FLEXPAY_MERCHANT_ID;
  const merchantSecret = process.env.FLEXPAY_MERCHANT_SECRET;
  const v5 = isV5Api(baseUrl);
  const checkUrl = resolveCheckUrl(reference);
  const usesV1Verify = !v5 && baseUrl.includes("/gateway") && Boolean(merchantId && merchantSecret);
  const flexpayTimeoutMs = Number(process.env.FLEXPAY_REQUEST_TIMEOUT_MS ?? 30000);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), flexpayTimeoutMs);

  try {
    const response = usesV1Verify
      ? await fetch(baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            merchant_id: merchantId,
            merchant_secrete: merchantSecret,
            action: "verify",
            reference,
          }),
          signal: controller.signal,
        })
      : await fetch(checkUrl, {
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
      console.warn("FlexPay status check returned non-OK", {
        reference,
        endpoint: usesV1Verify ? baseUrl : checkUrl,
        status: response.status,
        raw,
      });
      return { status: "PENDING", raw };
    }

    const status = parseProviderStatus(raw);
    console.log("FlexPay status check", { reference, status, raw });
    return { status, raw };
  } catch (error) {
    console.warn("FlexPay status check failed", {
      reference,
      endpoint: usesV1Verify ? baseUrl : checkUrl,
      error: error instanceof Error ? error.message : error,
    });
    return { status: "PENDING", raw: null };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function validateFlexpayWebhookSecret(headers: Headers | Record<string, unknown>) {
  // Encrypted sandbox callbacks use HMAC (X-Signature) verified in parseFlexpayWebhookBody.
  if (process.env.FLEXPAY_CALLBACK_HMAC_KEY?.trim()) {
    return true;
  }

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

function getHeaderValue(headers: Record<string, unknown>, name: string): string {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return String(value ?? "").trim();
    }
  }
  return "";
}

function toAes128Key(key: string): Buffer {
  const trimmed = key.trim();
  if (/^[0-9a-fA-F]{32}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  const buf = Buffer.from(trimmed, "utf8");
  if (buf.length === 16) return buf;
  if (buf.length > 16) return buf.subarray(0, 16);
  return Buffer.concat([buf, Buffer.alloc(16 - buf.length)]);
}

function secureCompare(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyFlexpayWebhookHmac(message: string, signature: string, hmacKey: string): boolean {
  const key = Buffer.from(hmacKey.trim(), "utf8");
  const digestHex = crypto.createHmac("sha256", key).update(message, "utf8").digest("hex");
  const digestBase64 = crypto.createHmac("sha256", key).update(message, "utf8").digest("base64");
  const normalized = signature.trim();
  return (
    secureCompare(normalized, digestHex) ||
    secureCompare(normalized, digestBase64) ||
    secureCompare(normalized.toLowerCase(), digestHex.toLowerCase())
  );
}

export function decryptFlexpayCallbackData(
  encryptedBase64: string,
  aesKeyRaw: string
): Record<string, unknown> {
  const key = toAes128Key(aesKeyRaw);
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, key);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, "base64")),
      decipher.final(),
    ]);
    const parsed = JSON.parse(decrypted.toString("utf8")) as unknown;
    return asRecord(parsed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`FLEXPAY_WEBHOOK_DECRYPT_FAILED:${reason}`);
  }
}

export function parseFlexpayWebhookBody(
  body: Record<string, unknown>,
  headers: Record<string, unknown>
): { payload: Record<string, unknown>; encrypted: boolean } {
  const encryptedData = typeof body.data === "string" ? body.data.trim() : "";
  if (!encryptedData) {
    return { payload: body, encrypted: false };
  }

  const aesKey =
    process.env.FLEXPAY_CALLBACK_AES_KEY?.trim() ??
    process.env.FLEXPAY_MERCHANT_SECRET?.trim() ??
    "";
  const hmacKey =
    process.env.FLEXPAY_CALLBACK_HMAC_KEY?.trim() ??
    process.env.FLEXPAY_WEBHOOK_SECRET?.trim() ??
    "";

  if (!aesKey) {
    throw new Error("FLEXPAY_CALLBACK_AES_KEY is required for encrypted webhooks");
  }

  const signature = getHeaderValue(headers, "x-signature");
  if (signature) {
    if (!hmacKey) {
      throw new Error("FLEXPAY_CALLBACK_HMAC_KEY is required when X-Signature is present");
    }
    const hmacValid =
      verifyFlexpayWebhookHmac(encryptedData, signature, hmacKey) ||
      verifyFlexpayWebhookHmac(JSON.stringify(body), signature, hmacKey);
    if (!hmacValid) {
      throw new Error("FLEXPAY_WEBHOOK_HMAC_INVALID");
    }
  }

  return {
    payload: decryptFlexpayCallbackData(encryptedData, aesKey),
    encrypted: true,
  };
}
