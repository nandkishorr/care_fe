import { QueryClient } from "@tanstack/react-query";

import {
  isFailedTransaction,
  isNetworkAvailability,
  NetworkOffer,
  ReferralNetworkCategory,
  ReferralTransactionRetrieve,
  ReferralUrgency,
  transactionErrorText,
} from "@/types/ccn/ccn";
import { ccnReferralApi } from "@/types/ccn/ccnApi";
import {
  ReferralAvailabilityRead,
  ReferralType,
} from "@/types/emr/referral/referral";
import { callApi } from "@/Utils/request/query";
import { sleep } from "@/Utils/utils";

export const NETWORK_POLL_INTERVAL_MS = 1500;
const CALLBACK_TIMEOUT_MS = 90_000;

export const HEALTH_SERVICE_TYPE_FOR_REFERRAL: Record<ReferralType, string> = {
  consultation: "PHYSICAL_CONSULTATION",
  lab: "LAB_TEST",
};

const CATEGORY_FOR_REFERRAL: Record<ReferralType, ReferralNetworkCategory> = {
  consultation: "patient_care",
  lab: "other",
};

/** Beckn urgency is `emergency` or a priority; the plugin treats >= 2 as urgent. */
const URGENCY_PRIORITY: Record<ReferralUrgency, number> = {
  routine: 1,
  urgent: 2,
  emergency: 3,
};

export class NetworkTransactionError extends Error {
  constructor(
    readonly reason: "failed" | "timeout",
    readonly transaction?: ReferralTransactionRetrieve,
  ) {
    super(reason);
  }
}

/** Polls the transaction until the `on_<action>` callback for it is stored. */
async function waitForCallback(
  transactionId: string,
  action: string,
  signal?: AbortSignal,
): Promise<ReferralTransactionRetrieve> {
  const expected = `ON_${action.toUpperCase()}`;
  const deadline = Date.now() + CALLBACK_TIMEOUT_MS;
  for (;;) {
    signal?.throwIfAborted();
    const transaction = await callApi(ccnReferralApi.get, {
      pathParams: { transactionId },
      silent: true,
      signal,
    });
    if (transaction.status === expected) return transaction;
    if (isFailedTransaction(transaction.status)) {
      throw new NetworkTransactionError("failed", transaction);
    }
    if (Date.now() > deadline) {
      throw new NetworkTransactionError("timeout", transaction);
    }
    await sleep(NETWORK_POLL_INTERVAL_MS);
  }
}

export interface NetworkReferralRequest {
  offer: NetworkOffer;
  facilityId: string;
  patientId: string;
  encounterId?: string;
  title: string;
  reason: string;
  referralType: ReferralType;
  urgency: ReferralUrgency;
}

export type NetworkReferralStep = "select" | "confirm";

/**
 * Sends a referral over the network: `select` the discovered offer, then
 * `confirm` it. The plugin creates the origin Care referral when the
 * coordinator activates the contract and exposes it as `referral_id`.
 */
export async function submitNetworkReferral(
  request: NetworkReferralRequest,
  onStep: (step: NetworkReferralStep) => void,
  signal?: AbortSignal,
): Promise<ReferralTransactionRetrieve> {
  const { offer } = request;
  const transactionId = offer.transactionId;

  onStep("select");
  await callApi(ccnReferralApi.select, {
    pathParams: { transactionId },
    body: { offer_id: offer.offerId, context: offer.context },
    signal,
  });
  await waitForCallback(transactionId, "select", signal);

  onStep("confirm");
  await callApi(ccnReferralApi.confirm, {
    pathParams: { transactionId },
    body: {
      facility: request.facilityId,
      patient: request.patientId,
      ...(request.encounterId ? { encounter: request.encounterId } : {}),
      title: request.title,
      reason: request.reason || undefined,
      category: CATEGORY_FOR_REFERRAL[request.referralType],
      offer_id: offer.offerId,
      assigned_facility_id: offer.providerId,
      emergency: request.urgency === "emergency",
      priority: URGENCY_PRIORITY[request.urgency],
    },
    signal,
  });
  return waitForCallback(transactionId, "confirm", signal);
}

// The plugin sends the sync from a background task after the edit commits, so
// the transaction may only move to `UPDATE` shortly after the edit returns.
const SYNC_REFRESH_DELAYS_MS = [0, 2000, 5000];

/**
 * Refreshes the network panel after an edit the plugin syncs (file link, form
 * answer, status change). Only active transaction queries refetch, and the
 * prefix covers both the referral id and an explicit `ccnTransactionId`.
 */
export function refreshNetworkTransaction(
  client: QueryClient,
  availabilityId?: string,
) {
  const availability = client.getQueryData<ReferralAvailabilityRead>([
    "referral-availability",
    availabilityId,
  ]);
  if (!availabilityId || !isNetworkAvailability(availability)) return;
  for (const delay of SYNC_REFRESH_DELAYS_MS) {
    setTimeout(() => {
      void client.invalidateQueries({
        queryKey: ["ccn", "referral", "transaction"],
      });
    }, delay);
  }
}

export function networkErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof NetworkTransactionError)) return undefined;
  return transactionErrorText(error.transaction?.last_error);
}
