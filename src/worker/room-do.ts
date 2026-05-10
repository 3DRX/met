import { DurableObject } from "cloudflare:workers";
import {
  isClientSignalMessage,
  type ClientSignalMessage,
  type ServerSignalMessage,
  type SocketTransport,
} from "../shared/signaling";
import { RoomSession } from "./room-session";

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDurableObject>;
}

type RoomSocketAttachment = {
  participantId: string;
};

export class RoomDurableObject extends DurableObject<Env> {
  private session: RoomSession | null = null;
  private sessionRoomId: string | null = null;
  private readonly socketIds = new WeakMap<WebSocket, string>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 400 });
    }

    const roomId = this.resolveRoomId(request);
    const session = this.getSession(roomId);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();

    const joinResult = session.join(this.toTransport(server));
    if (!joinResult.ok) {
      try {
        server.send(JSON.stringify({ type: "room-full", roomId }));
        server.close(4009, "room full");
      } catch {
        // Ignore close errors.
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    this.socketIds.set(server, joinResult.participantId);

    server.addEventListener("message", (event) => {
      const participantId = this.socketIds.get(server);
      if (!participantId) {
        return;
      }

      const parsed = this.parseMessage(event.data);
      if (!parsed || !isClientSignalMessage(parsed)) {
        return;
      }

      session.handleSignal(participantId, parsed);
    });

    server.addEventListener("close", () => {
      const participantId = this.socketIds.get(server);
      if (!participantId) {
        return;
      }
      this.socketIds.delete(server);
      session.leave(participantId);
    });

    server.addEventListener("error", () => {
      const participantId = this.socketIds.get(server);
      if (!participantId) {
        return;
      }
      this.socketIds.delete(server);
      session.leave(participantId);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private resolveRoomId(request: Request) {
    const match = new URL(request.url).pathname.match(/^\/api\/rooms\/([^/]+)\//);
    return match?.[1] ?? this.ctx.id.toString();
  }

  private getSession(roomId: string) {
    if (!this.session || this.sessionRoomId !== roomId) {
      this.session = new RoomSession(roomId);
      this.sessionRoomId = roomId;
    }
    return this.session;
  }

  private toTransport(socket: WebSocket): SocketTransport {
    return {
      send: (message: string) => {
        socket.send(message);
      },
      close: (code?: number, reason?: string) => {
        socket.close(code, reason);
      },
    };
  }

  private parseMessage(data: string | ArrayBuffer | ArrayBufferView) {
    if (typeof data === "string") {
      try {
        return JSON.parse(data) as unknown;
      } catch {
        return null;
      }
    }

    if (data instanceof ArrayBuffer) {
      try {
        return JSON.parse(new TextDecoder().decode(data)) as unknown;
      } catch {
        return null;
      }
    }

    try {
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
    } catch {
      return null;
    }
  }
}
