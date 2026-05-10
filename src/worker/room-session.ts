import {
  type ClientSignalMessage,
  type ParticipantSnapshot,
  type RoomRole,
  type RoomSnapshot,
  type ServerSignalMessage,
  type SocketTransport,
} from "../shared/signaling";

type ParticipantRecord = {
  id: string;
  socket: SocketTransport;
  role: RoomRole;
};

type RoomJoinResult =
  | { ok: true; participantId: string; role: RoomRole; participantCount: number }
  | { ok: false; reason: "room-full" };

export class RoomSession {
  private readonly participants: ParticipantRecord[] = [];
  private nextParticipantId = 1;

  constructor(private readonly roomId: string) {}

  join(socket: SocketTransport): RoomJoinResult {
    if (this.participants.length >= 2) {
      return { ok: false, reason: "room-full" };
    }

    const participantId = `${this.roomId}-${this.nextParticipantId++}`;
    const role: RoomRole = this.participants.length === 0 ? "host" : "guest";
    this.participants.push({ id: participantId, socket, role });
    this.rebalanceRoles();

    const participant = this.participants.find((entry) => entry.id === participantId);
    if (participant) {
      this.send(participant.socket, {
        type: "role",
        role: participant.role,
        participantCount: this.participants.length,
        roomId: this.roomId,
      });
    }

    this.broadcastRoomState();
    if (this.participants.length === 2) {
      this.broadcast({
        type: "peer-joined",
        participantCount: this.participants.length,
        roomId: this.roomId,
      });
    }

    return {
      ok: true,
      participantId,
      role: participant?.role ?? role,
      participantCount: this.participants.length,
    };
  }

  leave(participantId: string) {
    const beforeCount = this.participants.length;
    const index = this.participants.findIndex((entry) => entry.id === participantId);
    if (index === -1) {
      return;
    }

    this.participants.splice(index, 1);

    this.rebalanceRoles();
    this.broadcastRoomState();

    if (beforeCount === 2 && this.participants.length === 1) {
      const remaining = this.participants[0];
      this.send(remaining.socket, {
        type: "peer-left",
        participantCount: this.participants.length,
        roomId: this.roomId,
      });
      this.send(remaining.socket, {
        type: "role",
        role: remaining.role,
        participantCount: this.participants.length,
        roomId: this.roomId,
      });
    }
  }

  handleSignal(participantId: string, signal: ClientSignalMessage) {
    const sender = this.participants.find((entry) => entry.id === participantId);
    if (!sender) {
      return;
    }

    if (signal.type === "hangup") {
      const target = this.getPeer(participantId);
      if (target) {
        this.send(target.socket, {
          type: "signal",
          signal,
          roomId: this.roomId,
        });
      }
      return;
    }

    const target = this.getPeer(participantId);
    if (!target) {
      return;
    }

    this.send(target.socket, {
      type: "signal",
      signal,
      roomId: this.roomId,
    });
  }

  snapshot(): RoomSnapshot {
    return {
      roomId: this.roomId,
      participantCount: this.participants.length,
      participants: this.participants.map((entry): ParticipantSnapshot => ({
        id: entry.id,
        role: entry.role,
      })),
    };
  }

  hasCapacity() {
    return this.participants.length < 2;
  }

  getParticipantCount() {
    return this.participants.length;
  }

  private getPeer(participantId: string) {
    return this.participants.find((entry) => entry.id !== participantId);
  }

  private rebalanceRoles() {
    this.participants.forEach((participant, index) => {
      participant.role = index === 0 ? "host" : "guest";
    });
  }

  private broadcastRoomState() {
    this.broadcast({
      type: "room-state",
      participantCount: this.participants.length,
      roomId: this.roomId,
    });
  }

  private broadcast(message: ServerSignalMessage) {
    for (const participant of this.participants) {
      this.send(participant.socket, message);
    }
  }

  private send(socket: SocketTransport, message: ServerSignalMessage) {
    socket.send(JSON.stringify(message));
  }
}
