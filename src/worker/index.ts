import type { Env as RoomEnv } from "./room-do";
import { RoomDurableObject } from "./room-do";
import { makeRoomId } from "../shared/signaling";
import { generateTurnIceServers } from "./turn";

type WorkerEnv = RoomEnv & {
  ASSETS: Fetcher;
  TURN_KEY_ID: string;
  TURN_KEY_API_TOKEN: string;
  TURN_TTL_SECONDS: number;
};

export { RoomDurableObject };

const apiPrefix = "/api/rooms/";

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

function notFound(message = "Not found") {
  return json({ error: message }, { status: 404 });
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const roomId = makeRoomId();
      return json({
        roomId,
        roomUrl: new URL(`/room/${roomId}`, url.origin).toString(),
      });
    }

    if (url.pathname.startsWith(apiPrefix)) {
      const parts = url.pathname.slice(apiPrefix.length).split("/").filter(Boolean);
      const [roomId, resource] = parts;

      if (!roomId) {
        return notFound();
      }

      if (resource === "ice" && request.method === "GET") {
        const iceServers = await generateTurnIceServers(env);
        return json({
          roomId,
          iceServers,
        });
      }

      if (resource === "ws") {
        const id = env.ROOMS.idFromName(roomId);
        const stub = env.ROOMS.get(id);
        return stub.fetch(request);
      }

      return notFound();
    }

    return env.ASSETS.fetch(request);
  },
};
