export type EventSubscriber = (...params: never[]) => unknown;
export type EventsMap<Shape> = { [K in keyof Shape]: EventSubscriber };
export type Unsubscribe = () => void;

/** Minimal strongly-typed event emitter. App-specific event maps live in the apps. */
export default class EventEmitter<Events extends EventsMap<Events>> {
  private events: Map<keyof Events, Set<EventSubscriber>> = new Map();

  /** Registers a listener and returns a function that removes it. */
  on<K extends keyof Events>(eventName: K, callback: Events[K]): Unsubscribe {
    let callbacks = this.events.get(eventName);
    if (!callbacks) {
      callbacks = new Set();
      this.events.set(eventName, callbacks);
    }
    callbacks.add(callback);
    return () => this.off(eventName, callback);
  }

  /** Registers a listener that is removed after its first call. */
  once<K extends keyof Events>(eventName: K, callback: Events[K]): Unsubscribe {
    const wrapper = ((...params: Parameters<Events[K]>) => {
      this.off(eventName, wrapper);
      return callback(...params);
    }) as Events[K];
    return this.on(eventName, wrapper);
  }

  /** Removes one listener, or every listener of `eventName` when no callback is given. */
  off<K extends keyof Events>(eventName: K, callback?: Events[K]): boolean {
    const callbacks = this.events.get(eventName);
    if (!callbacks) return false;
    if (callback) return callbacks.delete(callback);
    callbacks.clear();
    return true;
  }

  emit<K extends keyof Events>(eventName: K, ...params: Parameters<Events[K]>): void {
    const callbacks = this.events.get(eventName);
    if (!callbacks) return;
    // Snapshot so listeners added during emit are not called in this round.
    for (const cb of Array.from(callbacks)) {
      (cb as (...args: Parameters<Events[K]>) => unknown)(...params);
    }
  }

  removeAllListeners(): void {
    this.events.clear();
  }
}
