export interface HubSpotContact {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  city?: string;
}

export async function fetchHubSpotContacts(): Promise<HubSpotContact[]> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return [];

  try {
    const res = await fetch(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=100",
      {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 300 },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results ?? []).map(
      (r: { id: string; properties: Record<string, string> }) => ({
        id: r.id,
        email: r.properties.email ?? "",
        firstName: r.properties.firstname ?? "",
        lastName: r.properties.lastname ?? "",
        city: r.properties.city,
      })
    );
  } catch {
    return [];
  }
}
