import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";

import { isNetworkAvailability } from "@/types/ccn/ccn";
import { referralAvailabilityApi } from "@/types/emr/referral/referralApi";
import query from "@/Utils/request/query";

/**
 * Referral list and detail payloads only carry the availability id, so the
 * availability is fetched once per id (shared cache) to tell network referrals apart.
 */
export function useIsNetworkReferral(availabilityId?: string) {
  const { data } = useQuery({
    queryKey: ["referral-availability", availabilityId],
    queryFn: query(referralAvailabilityApi.get, {
      pathParams: { availabilityId: availabilityId ?? "" },
      silent: true,
    }),
    enabled: !!availabilityId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return isNetworkAvailability(data);
}

export function ReferralNetworkBadge({
  availabilityId,
}: {
  availabilityId: string;
}) {
  const { t } = useTranslation();
  const isNetwork = useIsNetworkReferral(availabilityId);
  if (!isNetwork) return null;
  return (
    <Badge variant="info" size="sm" data-cy="referral-network-badge">
      <Network className="size-3" aria-hidden="true" />
      {t("ccn_network")}
    </Badge>
  );
}
