export type Mail = {
  from: string
  to: string
  subject: string
  text: string
  html: string
}
export type EmailBinding = { send: (message: Mail) => Promise<unknown> }

function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!
  )
}

/** Native Cloudflare Email Service. Local wrangler simulates this binding. */
export function createMailer(binding: EmailBinding, from: string) {
  if (!from || /[\r\n]/.test(from))
    throw new Error("EMAIL_FROM must be configured")
  return async ({
    to,
    subject,
    message,
    url,
    label,
    footer = "If you did not request this, you can ignore this email.",
  }: {
    to: string
    subject: string
    message: string
    url: string
    label: string
    /** Why the person is getting this; the default suits mail they asked for. */
    footer?: string
  }) => {
    const parsed = new URL(url)
    if (!["https:", "http:"].includes(parsed.protocol))
      throw new Error("Invalid email link")
    await binding.send({
      from,
      to,
      subject,
      text: `${message}\n\n${label}: ${url}\n\n${footer}`,
      html: `<p>${escape(message)}</p><p><a href="${escape(url)}">${escape(label)}</a></p><p>${escape(footer)}</p>`,
    })
  }
}
