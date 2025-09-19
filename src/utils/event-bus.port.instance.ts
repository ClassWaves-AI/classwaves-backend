import type { EventBusPort } from '../services/event-bus.port';
import { NamespacedEventBusAdapter } from '../adapters/event-bus.namespaced';

let instance: EventBusPort | null = null;

export function getEventBusPort(): EventBusPort {
  if (!instance) instance = new NamespacedEventBusAdapter();
  return instance;
}

export const eventBusPort: EventBusPort = getEventBusPort();

