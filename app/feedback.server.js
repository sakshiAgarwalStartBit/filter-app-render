import { Resend } from "resend";

const FEATURE_REQUEST_RECIPIENT = "sakshiagarwal@startbitsolutions.com";

// The text comes from a merchant, so it must never be interpreted as HTML in
// the email we receive.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const MAX_FEATURE_TITLE_LENGTH = 200;
export const MAX_FEATURE_DESCRIPTION_LENGTH = 5000;

export async function sendFeatureRequestEmail({ shop, title, description }) {
  const resend = new Resend(process.env.RESEND_API_KEY);

  const safeTitle = (title || "(no title)")
    .slice(0, MAX_FEATURE_TITLE_LENGTH)
    .replace(/[\r\n]+/g, " ");
  const safeDescription = description.slice(0, MAX_FEATURE_DESCRIPTION_LENGTH);
  const { error } = await resend.emails.send({
    from: "onboarding@resend.dev",
    to: FEATURE_REQUEST_RECIPIENT,
    subject: `Feature request: ${safeTitle}`,
    html: `
      <p><strong>Shop:</strong> ${escapeHtml(shop)}</p>
      <p><strong>Title:</strong> ${escapeHtml(safeTitle)}</p>
      <p><strong>Description:</strong></p>
      <p>${escapeHtml(safeDescription).replace(/\n/g, "<br />")}</p>
    `,
  });

  if (error) {
    throw new Error(error.message || "Resend failed to send the email");
  }
}
