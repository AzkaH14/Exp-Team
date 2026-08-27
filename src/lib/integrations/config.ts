export interface IntegrationConfig {
  id: string;
  name: string;
  description: string;
  status: "connected" | "disconnected" | "pending";
  envKeys: string[];
}

export const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: "google_sheets",
    name: "Sacred Google Sheet",
    description:
      "Live client registry — benefactor, beneficiary, city, status. Cross-checked with HubSpot on sync.",
    status: "pending",
    envKeys: ["GOOGLE_SHEETS_ID", "GOOGLE_SERVICE_ACCOUNT_JSON"],
  },
  {
    id: "hubspot",
    name: "HubSpot CRM",
    description: "Sync contacts, deals, and ticket metadata from HubSpot.",
    status: "pending",
    envKeys: ["HUBSPOT_ACCESS_TOKEN", "HUBSPOT_PORTAL_ID"],
  },
  {
    id: "odoo",
    name: "Odoo ERP",
    description: "Field service orders, inventory, and billing from Odoo.",
    status: "disconnected",
    envKeys: ["ODOO_URL", "ODOO_DB", "ODOO_USERNAME", "ODOO_API_KEY"],
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Client messaging, engagement nudges, and service confirmations.",
    status: "pending",
    envKeys: [
      "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_VERIFY_TOKEN",
    ],
  },
];

export function getIntegrationStatus(id: string): IntegrationConfig["status"] {
  const integration = INTEGRATIONS.find((i) => i.id === id);
  if (!integration) return "disconnected";

  if (id === "hubspot") {
    return process.env.HUBSPOT_ACCESS_TOKEN?.trim()
      ? "connected"
      : "pending";
  }

  if (id === "google_sheets") {
    return process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ||
      process.env.GOOGLE_SHEETS_API_KEY?.trim() ||
      process.env.GOOGLE_SHEETS_PUBLISH_CSV_URL?.trim()
      ? "connected"
      : "pending";
  }

  const requiredKeys =
    id === "hubspot"
      ? ["HUBSPOT_ACCESS_TOKEN"]
      : integration.envKeys;

  const configured = requiredKeys.every(
    (key) => process.env[key] && process.env[key]!.length > 0
  );
  return configured ? "connected" : integration.status;
}
