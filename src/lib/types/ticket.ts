export interface Ticket {
  id: string;
  ticketNumber: string;
  client: string;
  email: string | null;
  city: string;
  category: string;
  categoryFull: string;
  subCategory: string;
  name: string;
  description: string;
  /** Extra narrative from HubSpot custom fields (Special Requests / Notes, etc.) */
  hubspotFieldNotes?: string[];
  /** Session insight notes from the HubSpot ticket Notes tab */
  insightNotes?: string[];
  created: string;
  closed: string | null;
  month: string;
  priority: "urgent" | "normal" | string;
  /** Odoo workflow column (New / Planned / In Progress / Hold / Approval / Done / Cancelled). Absent on HubSpot-origin tickets. */
  stage?: string;
}

export interface TicketsPageResult {
  tickets: import("../ticket-queue-intelligence").TicketQueueRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  cities: string[];
  families: Array<{ registryId: string; label: string; city: string }>;
  summary: import("../ticket-queue-intelligence").TicketQueueSummary;
}
