import { Container, getContainer } from "@cloudflare/containers";

export interface Env {
  CONTROL_AGENT: DurableObjectNamespace<ControlAgentContainer>;
}

export class ControlAgentContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "10m";
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.CONTROL_AGENT, "control-agent-main");
    return container.fetch(request);
  },
} satisfies ExportedHandler<Env>;
