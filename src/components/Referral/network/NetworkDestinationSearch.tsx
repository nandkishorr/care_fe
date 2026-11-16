import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, RefreshCw, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

import {
  HEALTH_SERVICE_TYPE_FOR_REFERRAL,
  NETWORK_POLL_INTERVAL_MS,
} from "@/components/Referral/network/networkReferral";

import { cn } from "@/lib/utils";
import {
  BecknActionResponse,
  BecknDiscoverBody,
  extractNetworkOffers,
  isAwaitingCallback,
  isFailedTransaction,
  NetworkOffer,
  networkOfferLabel,
  ReferralTransactionRetrieve,
  transactionErrorText,
} from "@/types/ccn/ccn";
import { ccnMessageApi, ccnReferralApi } from "@/types/ccn/ccnApi";
import { ReferralType } from "@/types/emr/referral/referral";
import mutate from "@/Utils/request/mutate";
import query from "@/Utils/request/query";

const REFERRAL_TYPES: ReferralType[] = ["consultation", "lab"];
// Late responders keep answering a broadcast discover for a while.
const RESPONDER_WINDOW_MS = 20_000;

interface NetworkDestinationSearchProps {
  referralType: ReferralType;
  onReferralTypeChange: (referralType: ReferralType) => void;
  selected: NetworkOffer | null;
  onSelect: (offer: NetworkOffer) => void;
}

export function NetworkDestinationSearch({
  referralType,
  onReferralTypeChange,
  selected,
  onSelect,
}: NetworkDestinationSearchProps) {
  const { t } = useTranslation();
  const id = useId();
  const [search, setSearch] = useState("");
  const [transactionId, setTransactionId] = useState<string>();
  const [startedAt, setStartedAt] = useState(0);
  const discoverMutation = useMutation<
    BecknActionResponse,
    Error,
    BecknDiscoverBody
  >({
    mutationFn: mutate(ccnReferralApi.discover, { silent: true }),
    onMutate: () => setTransactionId(undefined),
    onSuccess: (response) => {
      setTransactionId(response.transaction_id);
      setStartedAt(Date.now());
    },
  });
  const { mutate: runDiscover } = discoverMutation;
  const discover = (textSearch: string) =>
    runDiscover({
      health_service_type: HEALTH_SERVICE_TYPE_FOR_REFERRAL[referralType],
      text_search: textSearch.trim() || undefined,
    });
  // Discover as soon as the network destination (or a new referral type) is chosen.
  const lastDiscovered = useRef<ReferralType>(undefined);
  useEffect(() => {
    if (lastDiscovered.current === referralType) return;
    lastDiscovered.current = referralType;
    runDiscover({
      health_service_type: HEALTH_SERVICE_TYPE_FOR_REFERRAL[referralType],
    });
  }, [referralType, runDiscover]);

  const transactionQuery = useQuery<ReferralTransactionRetrieve>({
    queryKey: ["ccn", "referral", "transaction", transactionId],
    queryFn: query(ccnReferralApi.get, {
      pathParams: { transactionId: transactionId ?? "" },
      silent: true,
    }),
    enabled: !!transactionId,
    refetchInterval: (q) =>
      isAwaitingCallback(q.state.data?.status ?? "QUEUED") &&
      Date.now() - startedAt < RESPONDER_WINDOW_MS
        ? NETWORK_POLL_INTERVAL_MS
        : false,
  });
  const status = transactionQuery.data?.status;
  const responded = !!status && !isAwaitingCallback(status);
  const failed = isFailedTransaction(status);
  const timedOut =
    !!transactionQuery.data &&
    !responded &&
    transactionQuery.dataUpdatedAt - startedAt >= RESPONDER_WINDOW_MS;
  const messagesQuery = useQuery({
    queryKey: ["ccn", "messages", transactionId, "on_discover"],
    queryFn: query(ccnMessageApi.bap, {
      queryParams: {
        transaction_id: transactionId ?? "",
        action: "on_discover",
        direction: "in",
        limit: 50,
      },
      silent: true,
    }),
    enabled: !!transactionId && responded && !failed,
    refetchInterval: () =>
      Date.now() - startedAt < RESPONDER_WINDOW_MS
        ? NETWORK_POLL_INTERVAL_MS * 2
        : false,
  });
  const offers = extractNetworkOffers(messagesQuery.data?.results ?? []);
  const searching =
    discoverMutation.isPending ||
    (!!transactionId && !responded && !timedOut && !transactionQuery.isError);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-48">
          <FieldLabel htmlFor={`${id}-type`}>{t("referral_type")}</FieldLabel>
          <Select
            value={referralType}
            onValueChange={(value: ReferralType) => onReferralTypeChange(value)}
          >
            <SelectTrigger id={`${id}-type`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REFERRAL_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`referral_type_${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <form
          className="flex min-w-0 flex-1 items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            discover(search);
          }}
        >
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor={`${id}-search`}>
              {t("ccn_network_search")}
            </FieldLabel>
            <Input
              id={`${id}-search`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("ccn_network_search_placeholder")}
            />
          </Field>
          <Button
            type="submit"
            variant="outline"
            disabled={discoverMutation.isPending}
          >
            {searching ? (
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="size-4" aria-hidden="true" />
            )}
            {t("search")}
          </Button>
        </form>
      </div>
      <div aria-live="polite" className="space-y-2">
        {searching && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Spinner className="size-4 animate-spin" aria-hidden="true" />
            {t("ccn_searching_network")}
          </p>
        )}
        {(discoverMutation.isError || transactionQuery.isError) && (
          <FieldError>{t("ccn_network_unavailable")}</FieldError>
        )}
        {failed && (
          <FieldError>
            {t("ccn_network_request_failed", {
              detail:
                transactionErrorText(transactionQuery.data?.last_error) ??
                status,
            })}
          </FieldError>
        )}
        {timedOut && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("ccn_network_no_response")}
          </p>
        )}
        {responded && !failed && !messagesQuery.isPending && !offers.length && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("ccn_no_network_providers")}
          </p>
        )}
      </div>
      {offers.length > 0 && (
        <div
          role="radiogroup"
          aria-label={t("ccn_network_providers")}
          className="grid gap-2 sm:grid-cols-2"
        >
          {offers.map((offer) => {
            const isSelected =
              selected?.offerId === offer.offerId &&
              selected.context.bpp_id === offer.context.bpp_id;
            return (
              <button
                key={offer.key}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onSelect(offer)}
                className={cn(
                  "flex min-w-0 items-start gap-2 rounded-lg border border-border bg-background p-3 text-left text-sm hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
                  isSelected && "border-primary ring-1 ring-primary",
                )}
              >
                <Check
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-primary",
                    !isSelected && "opacity-0",
                  )}
                />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block break-words font-medium">
                    {networkOfferLabel(offer)}
                  </span>
                  {offer.context.bpp_id && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {offer.context.bpp_id}
                    </span>
                  )}
                </span>
                <Badge variant="info" size="xs" className="shrink-0">
                  {t("ccn_network")}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
