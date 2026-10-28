export type EventSubscriber = (...params: never[]) => unknown;
export type EventsMap<Shape> = { [K in keyof Shape]: EventSubscriber };
export enum ApplicationEventTypes {
  PickColor = "eyedropper:color:picked",
  // Declare event types here...
}
export type ApplicationEventsMap = {
  [ApplicationEventTypes.PickColor]: (payload: { color: string; trySwitchTool: boolean }) => void;
  // Declare callback shapes for events...
};

export default class EventEmitter<Events extends EventsMap<Events>> {
  private events: Map<keyof Events, Set<EventSubscriber>> = new Map();

  /** Register new event listener. */
  on<K extends keyof Events>(eventName: K, callback: Events[K]): boolean {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, new Set());
    }

    const callbacks = this.events.get(eventName)!;

    if (callbacks.has(callback)) return false;

    callbacks.add(callback);
    return true;
  }

  /** Remove registered event listener. */
  off<K extends keyof Events>(eventName: K, callback?: Events[K]): boolean {
    if (!this.events.has(eventName)) return false;

    const callbacks = this.events.get(eventName)!;

    if (callback) return callbacks.delete(callback);

    callbacks.clear();
    return true;
  }

  /** Emit an event. */
  emit<K extends keyof Events>(eventName: K, ...params: Parameters<Events[K]>): void {
    if (!this.events.has(eventName)) return;

    const callbacks = this.events.get(eventName);
    if (!callbacks) return;

    callbacks.forEach((cb) => cb(...params));
  }
}

export const GlobalEmitter = new EventEmitter<ApplicationEventsMap>();
// Test
// GlobalEmitter.on(ApplicationEventTypes.PickColor, (payload) => {
//   const { color, trySwitchTool } = payload;
//   console.log(color, trySwitchTool);
// });
