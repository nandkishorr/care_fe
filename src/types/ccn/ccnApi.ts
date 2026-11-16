import { HttpMethod, PaginatedResponse, Type } from "@/Utils/request/types";

import {
  BecknActionResponse,
  BecknCatalogs,
  BecknDiscoverBody,
  BecknMessage,
  BecknTransactionList,
  ReferralConfirmBody,
  ReferralSelectBody,
  ReferralTransactionRetrieve,
} from "./ccn";

const BASE = "/api/care_ccn_be";

/** Care as the referring side (BAP): the FE drives discover → select → confirm. */
export const ccnReferralApi = {
  list: {
    path: `${BASE}/bap/referral/`,
    method: HttpMethod.GET,
    TRes: Type<PaginatedResponse<BecknTransactionList>>(),
  },
  get: {
    path: `${BASE}/bap/referral/{transactionId}/`,
    method: HttpMethod.GET,
    TRes: Type<ReferralTransactionRetrieve>(),
  },
  discover: {
    path: `${BASE}/bap/referral/discover/`,
    method: HttpMethod.POST,
    TBody: Type<BecknDiscoverBody>(),
    TRes: Type<BecknActionResponse>(),
  },
  catalogs: {
    path: `${BASE}/bap/referral/{transactionId}/catalogs/`,
    method: HttpMethod.GET,
    TRes: Type<BecknCatalogs>(),
  },
  select: {
    path: `${BASE}/bap/referral/{transactionId}/select/`,
    method: HttpMethod.POST,
    TBody: Type<ReferralSelectBody>(),
    TRes: Type<BecknActionResponse>(),
  },
  init: {
    path: `${BASE}/bap/referral/{transactionId}/init/`,
    method: HttpMethod.POST,
    TBody: Type<ReferralConfirmBody>(),
    TRes: Type<BecknActionResponse>(),
  },
  confirm: {
    path: `${BASE}/bap/referral/{transactionId}/confirm/`,
    method: HttpMethod.POST,
    TBody: Type<ReferralConfirmBody>(),
    TRes: Type<BecknActionResponse>(),
  },
  status: {
    path: `${BASE}/bap/referral/{transactionId}/status/`,
    method: HttpMethod.POST,
    TBody: Type<Record<string, never>>(),
    TRes: Type<BecknActionResponse>(),
  },
} as const;

/** Care as the receiving side (BPP): read-only. */
export const ccnIncomingReferralApi = {
  list: {
    path: `${BASE}/bpp/referral/`,
    method: HttpMethod.GET,
    TRes: Type<PaginatedResponse<BecknTransactionList>>(),
  },
  get: {
    path: `${BASE}/bpp/referral/{transactionId}/`,
    method: HttpMethod.GET,
    TRes: Type<ReferralTransactionRetrieve>(),
  },
} as const;

/** Stored requests and callbacks; `transaction_id` is a required query param. */
export const ccnMessageApi = {
  bap: {
    path: `${BASE}/bap/message/`,
    method: HttpMethod.GET,
    TRes: Type<PaginatedResponse<BecknMessage>>(),
  },
  bpp: {
    path: `${BASE}/bpp/message/`,
    method: HttpMethod.GET,
    TRes: Type<PaginatedResponse<BecknMessage>>(),
  },
} as const;
