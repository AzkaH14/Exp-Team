export interface WhatsAppMessage {
  to: string;
  template: string;
  status: "sent" | "delivered" | "read" | "failed";
}

export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  params: string[] = []
): Promise<{ success: boolean; messageId?: string }> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneId || !token) {
    return { success: false };
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: "en" },
            components: params.length
              ? [
                  {
                    type: "body",
                    parameters: params.map((p) => ({ type: "text", text: p })),
                  },
                ]
              : undefined,
          },
        }),
      }
    );
    if (!res.ok) return { success: false };
    const data = await res.json();
    return { success: true, messageId: data.messages?.[0]?.id };
  } catch {
    return { success: false };
  }
}
