export type RoomRole = "host" | "guest";

export type ClientSignalMessage =
  | { type: "offer"; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; candidate: RTCIceCandidateInit }
  | { type: "hangup" };

export type ServerSignalMessage =
  | {
      type: "role";
      role: RoomRole;
      participantCount: number;
      roomId: string;
    }
  | {
      type: "room-state";
      participantCount: number;
      roomId: string;
    }
  | {
      type: "peer-joined";
      participantCount: number;
      roomId: string;
    }
  | {
      type: "peer-left";
      participantCount: number;
      roomId: string;
    }
  | {
      type: "room-full";
      roomId: string;
    }
  | {
      type: "signal";
      signal: ClientSignalMessage;
      roomId: string;
    }
  | {
      type: "error";
      message: string;
      roomId: string;
    };

export type SocketTransport = {
  send: (message: string) => void;
  close?: (code?: number, reason?: string) => void;
};

export type ParticipantSnapshot = {
  id: string;
  role: RoomRole;
};

export type RoomSnapshot = {
  roomId: string;
  participantCount: number;
  participants: ParticipantSnapshot[];
};

export function isClientSignalMessage(value: unknown): value is ClientSignalMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as { type?: string };
  return (
    message.type === "offer" ||
    message.type === "answer" ||
    message.type === "ice-candidate" ||
    message.type === "hangup"
  );
}

export function extractRoomId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const directMatch = trimmed.match(/^([A-Za-z0-9_-]{4,64})$/);
  if (directMatch) {
    return directMatch[1];
  }

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const roomIndex = segments.indexOf("room");
    if (roomIndex >= 0 && segments[roomIndex + 1]) {
      return segments[roomIndex + 1];
    }
    return segments.at(-1) ?? null;
  } catch {
    return null;
  }
}

export function makeRoomId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export function buildInviteUrl(origin: string, roomId: string) {
  return new URL(`/room/${roomId}`, origin).toString();
}
