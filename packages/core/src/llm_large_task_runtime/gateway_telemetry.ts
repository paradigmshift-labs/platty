import type { LlmGatewayTelemetryEvent, LlmGatewayTelemetrySink, LlmGatewayTelemetrySnapshot } from './gateway_types.js'

export class InMemoryLlmGatewayTelemetrySink implements LlmGatewayTelemetrySink {
  readonly events: LlmGatewayTelemetryEvent[] = []

  record(event: LlmGatewayTelemetryEvent): void {
    this.events.push(event)
  }

  snapshot(): LlmGatewayTelemetrySnapshot {
    return { events: [...this.events] }
  }
}

export function createCompositeTelemetrySink(
  primary: InMemoryLlmGatewayTelemetrySink,
  secondary?: LlmGatewayTelemetrySink,
): LlmGatewayTelemetrySink {
  return {
    record(event) {
      primary.record(event)
      secondary?.record(event)
    },
  }
}
