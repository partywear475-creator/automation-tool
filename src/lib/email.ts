import { Resend } from "resend";
import { env } from "./env";

/** Report / alert email via Resend. Used by the report + alert workflows. */
export async function sendEmail(opts: {
  to?: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<void> {
  const key = env.resendKey();
  const to = opts.to ?? env.reportTo();
  if (!key) throw new Error("RESEND_API_KEY not set");
  if (!to) throw new Error("No recipient — set REPORT_TO_EMAIL or pass `to`");

  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: opts.from ?? env.reportFrom(),
    to,
    subject: opts.subject,
    html: opts.html,
  });
  if (error) throw new Error(`Resend failed: ${JSON.stringify(error)}`);
}
