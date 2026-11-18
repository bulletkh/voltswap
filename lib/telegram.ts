// Telegram notifications. Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (user id, group or @channel) in the server env.
export const telegramReady = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendTelegram(html: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) {
      let why = "";
      try {
        why = ((await r.json()) as { description?: string }).description ?? "";
      } catch {
        /* ignore */
      }
      console.error("[telegram] sendMessage failed:", r.status, why); // never logs the token
    }
    return r.ok;
  } catch (e) {
    console.error("[telegram] request error:", e instanceof Error ? e.name : "unknown");
    return false;
  }
}
