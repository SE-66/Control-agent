export class ControlAgentContainer {}

interface Env {
  ASSETS: Fetcher;
  OPENAI_API_KEY: string;
  APP_ACCESS_TOKEN: string;
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
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
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
      return json({ ok: true, service: "control-agent" });
    }

    if (url.pathname === "/api/chat") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405);
      }

      const auth = request.headers.get("authorization") ?? "";
      const expected = env.APP_ACCESS_TOKEN ? `Bearer ${env.APP_ACCESS_TOKEN}` : "";
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

      const message = String(body?.message ?? "").trim();
      if (!message || message.length > 20000) {
        return json({ error: "Message is required and must be under 20,000 characters" }, 400);
      }

      const previous = Array.isArray(body?.history) ? body.history.slice(-12) : [];
      const transcript = previous
        .filter((m: any) => m && (m.role === "user" || m.role === "assistant"))
        .map((m: any) => ({
          role: m.role,
          content: String(m.content ?? "").slice(0, 12000),
        }));
      transcript.push({ role: "user", content: message });

      const upstream = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
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

      const data: any = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        return json({
          error: data?.error?.message || "OpenAI API request failed",
          status: upstream.status,
        }, 502);
      }

      return json({
        reply: textFromResponse(data) || "No text response returned.",
        response_id: data?.id ?? null,
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
