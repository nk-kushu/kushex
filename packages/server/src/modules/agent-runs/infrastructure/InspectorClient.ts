type Pending = Readonly<{
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}>;
type Listener = (params: Record<string, unknown>) => void;

/** Raised when the inspected process rejects a command, e.g. a stale call frame. */
export class InspectorCommandError extends Error {}

/** One Chrome DevTools Protocol connection to a Node inspector, over its WebSocket URL. */
export class InspectorClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Listener[]>();
  private closed = false;

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => this.receive(String(event.data)));
    socket.addEventListener("close", () => this.fail(new Error("Inspector disconnected.")));
  }

  static connect(url: string): Promise<InspectorClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new InspectorClient(socket)), { once: true });
      socket.addEventListener("error", () => reject(new Error("Cannot reach the inspector.")), {
        once: true,
      });
    });
  }

  send<T = Record<string, unknown>>(method: string, params: object = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Inspector disconnected."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending["resolve"], reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method: string, listener: Listener): void {
    this.listeners.set(method, [...(this.listeners.get(method) ?? []), listener]);
  }

  close(): void {
    if (this.closed) return;
    this.socket.close();
    this.fail(new Error("Inspector disconnected."));
  }

  private receive(data: string): void {
    const message = JSON.parse(data) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error)
        pending?.reject(new InspectorCommandError(message.error.message ?? "Inspector error."));
      else pending?.resolve(message.result ?? {});
      return;
    }
    for (const listener of this.listeners.get(message.method ?? "") ?? [])
      listener(message.params ?? {});
  }

  private fail(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
