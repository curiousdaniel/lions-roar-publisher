import { Resend } from "resend";

export async function notifyNewRecording(params: {
  topic: string;
  startTime: string;
  editUrl: string;
}): Promise<void> {
  const to = process.env.NOTIFY_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  const from = "Lion's Roar Publisher <onboarding@resend.dev>";

  if (!to || !apiKey) return;

  try {
    const resend = new Resend(apiKey);
    const date = new Date(params.startTime).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    await resend.emails.send({
      from,
      to,
      subject: `New Sunday Talk ready to edit - ${date}`,
      html: `<p>A new recording is ready: <strong>${params.topic}</strong></p><p><a href="${params.editUrl}">Open editor</a></p>`,
      text: `A new recording is ready: ${params.topic}\n\nOpen editor: ${params.editUrl}`,
    });
  } catch (error) {
    console.error("Failed to send notification email", error);
  }
}
