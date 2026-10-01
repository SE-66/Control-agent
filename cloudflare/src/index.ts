export class ControlAgentContainer {}

interface Env {
  ASSETS: Fetcher;
  OPENAI_API_KEY: string;
  APP_ACCESS_TOKEN: string;
  CHAT_RATE_LIMITER: RateLimit;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function textFromResponse(data: any): string {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const parts: string[] = [];
  if (!Array.isArray(data?.output)) return "";
  for (const item of data.output) {
    if (item?.content === undefined) continue;
    if (!Array.isArray(item?.content)) return "";
    for (const content of item.content) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        const response = json({ error: "Method not allowed" }, 405);
        response.headers.set("allow", "GET");
        return response;
      }
      return json({ ok: true, service: "control-agent", app_access_token_configured: Boolean(env.APP_ACCESS_TOKEN), openai_api_key_configured: Boolean(env.OPENAI_API_KEY) });
    }

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        const response = json({ error: "Method not allowed" }, 405);
        response.headers.set("allow", "POST");
        return response;
      }

      const auth = request.headers.get("authorization") ?? "";
      const accessToken = env.APP_ACCESS_TOKEN?.trim();
      const expected = accessToken ? `Bearer ${accessToken}` : "";
      if (!expected || auth !== expected) {
        return json({ error: "Unauthorized" }, 401);
      }

      if (!env.OPENAI_API_KEY) {
        return json({ error: "OPENAI_API_KEY is not configured" }, 503);
      }

      let body: any;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      if (typeof body?.message !== "string") {
        return json({ error: "Message must be a string" }, 400);
      }
      const message = body.message.trim();
      if (!message || message.length > 20000) {
        return json({ error: "Message is required and must be under 20,000 characters" }, 400);
      }

      if (body.history !== undefined && (!Array.isArray(body.history) || body.history.some(
        (m: any) => !m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string"
      ))) {
        return json({ error: "History must contain user or assistant messages with string content" }, 400);
      }
      const previous = (body.history ?? []).slice(-12);
      const transcript = previous
        .map((m: any) => ({
          role: m.role,
          content: m.content.slice(0, 12000),
        }));
      transcript.push({ role: "user", content: message });

      if (!env.CHAT_RATE_LIMITER) return json({ error: "Chat is temporarily unavailable" }, 503);
      try {
        const { success } = await env.CHAT_RATE_LIMITER.limit({ key: "control-agent-chat" });
        if (!success) {
          const response = json({ error: "Too many requests. Try again in a minute." }, 429);
          response.headers.set("retry-after", "60");
          return response;
        }
      } catch {
        return json({ error: "Chat is temporarily unavailable" }, 503);
      }

      let upstream: Response;
      let data: any;
      try {
        upstream = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          signal: AbortSignal.timeout(30000),
          headers: {
            "authorization": `Bearer ${env.OPENAI_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-5.6",
            store: false,
            instructions:
              "You are Control Agent, a coding and repository assistant. Be concise and practical. " +
              "You are running behind a Cloudflare Worker. Do not claim you executed terminal commands, " +
              "edited GitHub, or changed files unless a connected execution tool actually performed that action.",
            input: transcript,
          }),
        });
        data = await upstream.json();
      } catch {
        return json({ error: "OpenAI API request failed" }, 502);
      }
      if (!upstream.ok) {
        return json({
          error: "OpenAI API request failed",
          status: upstream.status,
        }, 502);
      }

      const reply = textFromResponse(data);
      if (!reply) return json({ error: "OpenAI API returned no text response" }, 502);
      return json({
        reply,
        response_id: data?.id ?? null,
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
