FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

RUN git clone --depth=1 https://github.com/SE-66/Control-agent.git /opt/control-agent

COPY server.mjs /opt/cloudflare/server.mjs
COPY start.sh /opt/cloudflare/start.sh
RUN chmod +x /opt/cloudflare/start.sh

EXPOSE 8080

CMD ["/opt/cloudflare/start.sh"]
