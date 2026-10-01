import http from "node:http";

const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = 3456;
const LISTEN_PORT = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  const headers = { ...req.headers };
  headers.host = `localhost:${TARGET_PORT}`;
  delete headers.origin;
  delete headers.referer;

  const upstream = http.request(
    {
      host: TARGET_HOST,
      port: TARGET_PORT,
      method: req.method,
      path: req.url,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on("error", (error) => {
    res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: error.message }));
  });

  req.pipe(upstream);
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(`Control-agent proxy listening on 0.0.0.0:${LISTEN_PORT}`);
});
