import { test, expect } from "@playwright/test";
import { TestApi } from "./helpers";

test.describe("Connections page", () => {
  test.beforeEach(async ({ request }) => {
    await new TestApi(request).fullReset();
  });

  test("empty state invites the user to create one", async ({ page }) => {
    await page.goto("/#/connections");
    await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();
    await expect(page.getByText("No connections yet")).toBeVisible();
  });

  test("creates a claude connection via the form", async ({ page, request }) => {
    await page.goto("/#/connections");
    // Click the primary "+ New connection" in the header.
    await page
      .getByRole("button", { name: /\+ New connection/ })
      .first()
      .click();

    // Form renders with Type dropdown.
    await expect(page.getByLabel("Type")).toBeVisible();
    await page.getByLabel("Name").fill("my claude");
    // Default type is Claude, default model is Sonnet — just save.
    await page.getByRole("button", { name: "Create" }).click();

    // Back on the list, our connection appears.
    await expect(page.getByText("my claude")).toBeVisible();

    // Verify DB row.
    const api = new TestApi(request);
    const rows = (await api.dbTable("agent_connectors")) as Array<{
      name: string;
      type: string;
      config: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("my claude");
    expect(rows[0].type).toBe("claude");
  });

  test("edits a connection name", async ({ page, request }) => {
    // Seed a stub connector via API.
    const token = await getToken(request);
    await createConnector(request, token, "original-name");

    await page.goto("/#/connections");
    await expect(page.getByText("original-name")).toBeVisible();
    await page
      .getByRole("button", { name: /✎ Edit/ })
      .first()
      .click();

    const nameField = page.getByLabel("Name");
    await nameField.fill("renamed");
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("renamed")).toBeVisible();
    await expect(page.getByText("original-name")).toHaveCount(0);
  });

  test("deletes a connection with confirmation", async ({ page, request }) => {
    const token = await getToken(request);
    await createConnector(request, token, "to-delete");

    await page.goto("/#/connections");
    await expect(page.getByText("to-delete")).toBeVisible();

    // First click arms the confirm.
    await page.getByRole("button", { name: /🗑 Delete/ }).click();
    // Second click deletes.
    await page.getByRole("button", { name: "Confirm delete" }).click();

    await expect(page.getByText("No connections yet")).toBeVisible();
    const api = new TestApi(request);
    expect(await api.dbTable("agent_connectors")).toHaveLength(0);
  });

  test("test button runs a stub round-trip", async ({ page, request }) => {
    const api = new TestApi(request);
    await api.setDefaultAgentReply("pong");
    const token = await getToken(request);
    await createConnector(request, token, "pingable");

    await page.goto("/#/connections");
    await page.getByRole("button", { name: /🧪 Test/ }).click();

    await expect(page.getByText("✓ Connected")).toBeVisible();
  });
});

async function getToken(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const res = await request.post("/api/auth/local");
  return (await res.json()).session.access_token;
}

async function createConnector(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  name: string,
): Promise<string> {
  const res = await request.post("/api/agent-connectors", {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, type: "stub", config: {} },
  });
  if (!res.ok()) throw new Error(`create connector failed: ${res.status()} ${await res.text()}`);
  return (await res.json()).connector_id;
}
