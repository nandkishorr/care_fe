import { ReferralAvailabilityRead } from "@/types/emr/referral/referral";
import { UserReadMinimal } from "@/types/user/user";

export type BecknFlow = "referral" | "appointment";

export type BecknAdapter = "bap" | "bpp";

/**
 * Lifecycle of a plugin transaction: `QUEUED` until ONIX acknowledges the
 * request, then the uppercase action (e.g. `SELECT`) and `ON_<ACTION>` once
 * the callback is stored. `NACK` / `ERROR` carry `last_error`.
 */
export type BecknTransactionStatus = string;

export interface BecknLastError {
  code?: string;
  message?: string;
  [key: string]: unknown;
}

export interface BecknTransactionList {
  id: string;
  transaction_id: string;
  adapter: BecknAdapter;
  flow: BecknFlow;
  status: BecknTransactionStatus;
  network_id: string;
  counterparty_id: string;
  counterparty_uri: string;
  contract_id: string;
  coordination_id: string;
  last_error: BecknLastError | null;
  created_date: string | null;
  modified_date: string | null;
}

export interface BecknRouting {
  bap_id?: string;
  bap_uri?: string;
  bpp_id?: string;
  bpp_uri?: string;
}

export interface BecknTransactionRetrieve extends BecknTransactionList {
  routing: BecknRouting;
  context: Record<string, unknown>;
  actions: string[];
  patient: string | null;
  facility: string | null;
  created_by: UserReadMinimal | null;
}

export interface ReferralTransactionRetrieve extends BecknTransactionRetrieve {
  /** The origin Care referral; `transaction_id` equals it for Care-created referrals. */
  referral_id: string | null;
  confirm: Record<string, unknown> | null;
}

export interface BecknMessage {
  id: number;
  transaction_id: string | null;
  message_id: string;
  action: string;
  direction: string;
  delivery_status: string;
  processing_status: string;
  attempts: number;
  last_error: string;
  payload: {
    context?: Record<string, unknown>;
    message?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
  ack: Record<string, unknown> | null;
  reply_to: number | null;
  created_date: string | null;
  modified_date: string | null;
}

/** Context overrides; the plugin validates all five routing keys as required. */
export interface BecknContextOverride {
  network_id: string;
  bap_id: string;
  bap_uri: string;
  bpp_id: string;
  bpp_uri: string;
  version?: string;
  ttl?: string;
  schema_context?: string[];
}

interface BecknActionBody {
  context?: BecknContextOverride;
  message?: Record<string, unknown>;
}

export interface BecknDiscoverBody extends BecknActionBody {
  health_service_type?: string;
  acceptance_mode?: string;
  text_search?: string;
  filters?: Record<string, unknown>;
}

export interface ReferralSelectBody extends BecknActionBody {
  offer_id: string;
}

/** The plugin maps `patient_care` to a consultation and anything else to a lab referral. */
export type ReferralNetworkCategory = "patient_care" | "other";

/**
 * `facility` is the origin Care facility the plugin creates the referral from.
 * `encounter` links the origin referral to that encounter; it stays in Care and
 * is never sent over the network.
 */
export interface ReferralConfirmBody extends BecknActionBody {
  facility: string;
  patient?: string;
  patient_name?: string;
  encounter?: string;
  title?: string;
  reason?: string;
  category?: ReferralNetworkCategory;
  offer_id?: string;
  assigned_facility_id?: string;
  emergency?: boolean;
  priority?: number;
}

export interface BecknActionResponse {
  transaction_id: string;
  message_id: string;
  action: string;
  status: BecknTransactionStatus;
}

export interface BecknCatalogs {
  transaction_id: string;
  catalogs: Record<string, unknown>[];
}

export type ReferralUrgency = "routine" | "urgent" | "emergency";

export const REFERRAL_URGENCIES: ReferralUrgency[] = [
  "routine",
  "urgent",
  "emergency",
];

/** One provider offer flattened from an `on_discover` catalog. */
export interface NetworkOffer {
  key: string;
  transactionId: string;
  offerId: string;
  offerName?: string;
  providerId?: string;
  providerName?: string;
  catalogName?: string;
  context: BecknContextOverride;
}

export function isNetworkAvailability(
  availability?: Pick<ReferralAvailabilityRead, "entity_type"> | null,
) {
  return availability?.entity_type === "external";
}

export function isFailedTransaction(status?: string) {
  return status === "NACK" || status === "ERROR";
}

/** Gateway errors can carry whole HTML bodies; keep user-facing text short. */
export function transactionErrorText(
  lastError?: BecknLastError | null,
  maxLength = 200,
) {
  const text = lastError?.message ?? lastError?.code;
  if (!text) return undefined;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

/** A request is in flight until its `ON_<ACTION>` callback or a failure. */
export function isAwaitingCallback(status?: string) {
  return !!status && !status.startsWith("ON_") && !isFailedTransaction(status);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function descriptorName(value: unknown): string | undefined {
  return asString(asRecord(asRecord(value)?.descriptor)?.name);
}

/**
 * Flattens every stored `on_discover` callback into selectable offers. A
 * discover can be answered by several BPPs, so each offer keeps the routing of
 * the envelope (or catalog) it came from for the follow-up `select`/`confirm`.
 */
export function extractNetworkOffers(messages: BecknMessage[]): NetworkOffer[] {
  const offers: NetworkOffer[] = [];
  messages.forEach((message, messageIndex) => {
    const context = asRecord(message.payload.context) ?? {};
    const catalogs = asArray(asRecord(message.payload.message)?.catalogs);
    catalogs.forEach((rawCatalog, catalogIndex) => {
      const catalog = asRecord(rawCatalog);
      if (!catalog) return;
      const provider = asRecord(catalog.provider);
      const routing: BecknContextOverride = {
        network_id: asString(context.networkId) ?? "",
        bap_id: asString(context.bapId) ?? "",
        bap_uri: asString(context.bapUri) ?? "",
        bpp_id: asString(catalog.bppId) ?? asString(context.bppId) ?? "",
        bpp_uri: asString(catalog.bppUri) ?? asString(context.bppUri) ?? "",
      };
      asArray(catalog.offers).forEach((rawOffer, offerIndex) => {
        const offerId = asString(asRecord(rawOffer)?.id);
        if (!offerId) return;
        offers.push({
          key: `${messageIndex}-${catalogIndex}-${offerIndex}`,
          transactionId: message.transaction_id ?? "",
          offerId,
          offerName: descriptorName(rawOffer),
          providerId: asString(provider?.id),
          providerName: descriptorName(provider) ?? descriptorName(catalog),
          catalogName: descriptorName(catalog),
          context: routing,
        });
      });
    });
  });
  return offers;
}

export function networkOfferLabel(offer: NetworkOffer) {
  return (
    [offer.providerName, offer.offerName].filter(Boolean).join(" — ") ||
    offer.catalogName ||
    offer.offerId
  );
}
