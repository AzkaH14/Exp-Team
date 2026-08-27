import type { QoLScore } from "./qol";

/** Lightweight row for client list tables — no full dimension breakdown */
export interface ClientQoLListItem {
  client: string;
  slug: string;
  city: string;
  email: string | null;
  tickets: number;
  overall: number;
  band: QoLScore["band"];
  urgentFlags: string[];
}
