FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git bash \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/control-agent

COPY . /opt/control-agent

RUN chmod +x /opt/control-agent/cloudflare/start.sh

EXPOSE 8080

CMD ["/opt/control-agent/cloudflare/start.sh"]
