import { describe, expect, it } from "vitest";
import { RoomSession } from "./room-session";
import type { SocketTransport } from "../shared/signaling";

function createSocket() {
  const messages: string[] = [];
  const socket: SocketTransport = {
    send: (message: string) => {
      messages.push(message);
    },
  };
  return { socket, messages };
}

describe("RoomSession", () => {
  it("accepts two participants and rejects a third", () => {
    const session = new RoomSession("room-a");
    const first = createSocket();
    const second = createSocket();
    const third = createSocket();

    expect(session.join(first.socket)).toMatchObject({
      ok: true,
      role: "host",
      participantCount: 1,
    });
    expect(session.join(second.socket)).toMatchObject({
      ok: true,
      role: "guest",
      participantCount: 2,
    });
    expect(session.join(third.socket)).toEqual({
      ok: false,
      reason: "room-full",
    });
  });

  it("promotes the remaining participant after disconnect", () => {
    const session = new RoomSession("room-b");
    const first = createSocket();
    const second = createSocket();

    const host = session.join(first.socket);
    const guest = session.join(second.socket);

    expect(host.ok && host.participantId).toBeTruthy();
    expect(guest.ok && guest.participantId).toBeTruthy();

    if (!host.ok || !guest.ok) {
      throw new Error("unexpected join failure");
    }

    session.leave(host.participantId);

    expect(second.messages.some((message) => message.includes('"type":"peer-left"'))).toBe(true);
    expect(second.messages.some((message) => message.includes('"type":"role"'))).toBe(true);
    expect(session.snapshot().participants).toEqual([
      { id: guest.participantId, role: "host" },
    ]);
  });
});
