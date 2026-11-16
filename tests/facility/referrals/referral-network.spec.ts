import { faker } from "@faker-js/faker";
import { expect, type Page, test } from "@playwright/test";
import { createReferralFixture } from "tests/helper/referrals";

test.use({ storageState: "tests/.auth/user.json" });

// The CCN plugin talks to a Beckn gateway that is not part of the test stack.
// Its endpoints are mocked here; the Care referral the plugin would create on
// `on_confirm` is a real fixture so the referral views run against the backend.
const CCN = /\/api\/care_ccn_be\//;

function json(body: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

function transaction(
  transactionId: string,
  status: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id: faker.string.uuid(),
    transaction_id: transactionId,
    adapter: "bap",
    flow: "referral",
    status,
    network_id: "nfh",
    counterparty_id: "cc.bpp",
    counterparty_uri: "https://cc.example/bpp",
    contract_id: status === "ON_CONFIRM" ? "contract-1" : "",
    coordination_id: transactionId,
    last_error: null,
    created_date: new Date().toISOString(),
    modified_date: new Date().toISOString(),
    routing: {},
    context: {},
    actions: ["DISCOVER", "ON_DISCOVER"],
    patient: null,
    facility: null,
    created_by: null,
    referral_id: null,
    confirm: null,
    ...extra,
  };
}

/** Make the fixture's availability a network (Beckn) availability. */
async function markAvailabilityAsNetwork(page: Page, availabilityId: string) {
  await page.route(
    new RegExp(`/api/v1/referral_availability/${availabilityId}/$`),
    async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          ...body,
          entity_type: "external",
          facility: null,
          external_entity: {
            beckn: { bppId: "cc.bpp", bppUri: "https://cc.example/bpp" },
          },
        },
      });
    },
  );
}

test("sends a referral through the CCN network and shows its network status", async ({
  page,
  request,
}) => {
  const fixture = await createReferralFixture(request);
  const transactionId = faker.string.uuid();
  const offerName = `Network desk ${fixture.suffix}`;
  const title = `Network referral ${fixture.suffix}`;
  let selectBody: Record<string, unknown> | undefined;
  let confirmBody: Record<string, unknown> | undefined;
  let status = "ON_DISCOVER";

  await markAvailabilityAsNetwork(page, fixture.availabilityId);
  await page.route(CCN, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const accepted = (action: string) =>
      route.fulfill(
        json(
          {
            transaction_id: transactionId,
            message_id: faker.string.uuid(),
            action,
            status: "QUEUED",
          },
          202,
        ),
      );
    if (url.pathname.endsWith("/bap/referral/discover/")) {
      return accepted("discover");
    }
    if (url.pathname.endsWith(`/bap/referral/${transactionId}/select/`)) {
      selectBody = route.request().postDataJSON();
      status = "ON_SELECT";
      return accepted("select");
    }
    if (url.pathname.endsWith(`/bap/referral/${transactionId}/confirm/`)) {
      confirmBody = route.request().postDataJSON();
      status = "ON_CONFIRM";
      return accepted("confirm");
    }
    if (url.pathname.endsWith(`/bap/referral/${transactionId}/`)) {
      return route.fulfill(
        json(
          transaction(transactionId, status, {
            referral_id: status === "ON_CONFIRM" ? fixture.referralId : null,
          }),
        ),
      );
    }
    if (url.pathname.endsWith(`/bap/referral/${fixture.referralId}/`)) {
      return route.fulfill(
        json(
          transaction(fixture.referralId, "ON_CONFIRM", {
            referral_id: fixture.referralId,
            actions: ["CONFIRM", "ON_CONFIRM"],
          }),
        ),
      );
    }
    if (url.pathname.endsWith("/bap/message/") && method === "GET") {
      return route.fulfill(
        json({
          count: 1,
          results: [
            {
              id: 1,
              transaction_id: transactionId,
              message_id: "m-1",
              action: "on_discover",
              direction: "in",
              payload: {
                context: {
                  networkId: "nfh",
                  bapId: "care.bap",
                  bapUri: "https://care.example/bap",
                  bppId: "cc.bpp",
                  bppUri: "https://cc.example/bpp",
                },
                message: {
                  catalogs: [
                    {
                      provider: {
                        id: fixture.facilityId,
                        descriptor: { name: offerName },
                      },
                      offers: [
                        {
                          id: "offer-1",
                          descriptor: { name: "Consultation" },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        }),
      );
    }
    return route.fulfill(json({ errors: [{ msg: "unexpected" }] }, 404));
  });

  await test.step("Pick a provider discovered on the network", async () => {
    await page.goto(
      `/facility/${fixture.facilityId}/patient/${fixture.patientId}/encounter/${fixture.encounterId}/referrals`,
    );
    await page.getByRole("button", { name: "New Referral" }).click();
    await page.getByRole("combobox", { name: "Refer to" }).click();
    await page.getByRole("option", { name: "Network (CCN)" }).click();
    await page
      .getByRole("radio", { name: new RegExp(`${offerName} — Consultation`) })
      .click();
    await expect(
      page.getByRole("region", { name: "Destination" }),
    ).toContainText(offerName);
  });

  await test.step("Review and send the network referral", async () => {
    await page.getByRole("textbox", { name: "Referral title" }).fill(title);
    await page.getByRole("combobox", { name: "Urgency" }).click();
    await page.getByRole("option", { name: "Urgent" }).click();
    await page.getByRole("button", { name: "Review referral" }).click();
    await expect(page.getByText("Urgency: Urgent")).toBeVisible();
    await page.getByRole("button", { name: "Send referral" }).click();
    await expect(
      page.getByText("Referral sent through the CCN network"),
    ).toBeVisible();
  });

  await test.step("The plugin received the full routing and request", async () => {
    expect(selectBody).toMatchObject({
      offer_id: "offer-1",
      context: {
        network_id: "nfh",
        bap_id: "care.bap",
        bap_uri: "https://care.example/bap",
        bpp_id: "cc.bpp",
        bpp_uri: "https://cc.example/bpp",
      },
    });
    expect(confirmBody).toMatchObject({
      facility: fixture.facilityId,
      patient: fixture.patientId,
      title,
      category: "patient_care",
      offer_id: "offer-1",
      assigned_facility_id: fixture.facilityId,
      emergency: false,
      priority: 2,
    });
  });

  await test.step("Network referrals are marked in the list and details", async () => {
    const row = page
      .locator("[data-cy='referral-row']")
      .filter({ hasText: fixture.title });
    await expect(
      row.locator("[data-cy='referral-network-badge']"),
    ).toBeVisible();
    await page.goto(fixture.path);
    await expect(
      page.locator("[data-cy='referral-network-badge']").first(),
    ).toBeVisible();
    const status = page.locator("[data-cy='referral-network-status']");
    await expect(status).toContainText("Confirmed");
    await expect(status).toContainText("cc.bpp");
  });
});

test("lists outgoing and incoming network transactions", async ({
  page,
  request,
}) => {
  const fixture = await createReferralFixture(request);
  const outgoingId = faker.string.uuid();
  const incomingId = faker.string.uuid();

  await markAvailabilityAsNetwork(page, fixture.availabilityId);
  await page.route(CCN, async (route) => {
    const { pathname } = new URL(route.request().url());
    const list = (item: unknown) => json({ count: 1, results: [item] });
    if (pathname.endsWith("/bap/referral/")) {
      return route.fulfill(list(transaction(outgoingId, "ON_CONFIRM")));
    }
    if (pathname.endsWith("/bpp/referral/")) {
      return route.fulfill(
        list({ ...transaction(incomingId, "NACK"), adapter: "bpp" }),
      );
    }
    if (pathname.endsWith(`/bap/referral/${outgoingId}/`)) {
      return route.fulfill(
        json(
          transaction(outgoingId, "ON_CONFIRM", {
            referral_id: fixture.referralId,
          }),
        ),
      );
    }
    if (pathname.endsWith(`/bap/referral/${fixture.referralId}/`)) {
      return route.fulfill(json({ errors: [{ msg: "not found" }] }, 404));
    }
    if (pathname.endsWith("/message/")) {
      return route.fulfill(json({ count: 0, results: [] }));
    }
    return route.fulfill(json({ errors: [{ msg: "unexpected" }] }, 404));
  });

  await page.goto(`/facility/${fixture.facilityId}/network_referrals`);
  const rows = page.locator("[data-cy='ccn-transaction-row']");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(outgoingId);
  await expect(rows.first()).toContainText("Confirmed");

  await page.getByRole("tab", { name: "Incoming" }).click();
  await expect(rows.first()).toContainText(incomingId);
  await expect(rows.first()).toContainText("Failed");

  await page.getByRole("tab", { name: "Outgoing" }).click();
  await page.getByRole("button", { name: outgoingId }).click();
  await page.locator("[data-cy='ccn-open-referral']").click();
  await expect(page).toHaveURL(new RegExp(`/referrals/${fixture.referralId}`));
  await expect(
    page.locator("[data-cy='referral-network-status']"),
  ).toContainText("Confirmed");
});
