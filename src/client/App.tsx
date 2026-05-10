import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  Copy,
  LayoutGrid,
  Link2,
  Mic,
  MicOff,
  Phone,
  Plus,
  RefreshCw,
  Video,
  VideoOff,
} from "lucide-react";
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { buildInviteUrl, extractRoomId } from "../shared/signaling";
import type { ClientSignalMessage, RoomRole, ServerSignalMessage } from "../shared/signaling";

type IceServerResponse = {
  roomId: string;
  iceServers: RTCIceServer[];
};

type SessionStatus =
  | "idle"
  | "getting-media"
  | "connecting"
  | "waiting-for-peer"
  | "connected"
  | "reconnecting"
  | "ended"
  | "error";

type RoomConnectionState = {
  status: SessionStatus;
  message: string;
  role: RoomRole | null;
  participantCount: number;
  roomId: string | null;
  inviteUrl: string | null;
};

const initialConnectionState: RoomConnectionState = {
  status: "idle",
  message: "Ready to join a room.",
  role: null,
  participantCount: 0,
  roomId: null,
  inviteUrl: null,
};

function joinRoomPath(roomId: string) {
  return `/room/${roomId}`;
}

function formatStatus(status: SessionStatus) {
  switch (status) {
    case "getting-media":
      return "Requesting camera and microphone";
    case "connecting":
      return "Connecting to the room";
    case "waiting-for-peer":
      return "Waiting for the second participant";
    case "connected":
      return "Call connected";
    case "reconnecting":
      return "Reconnecting";
    case "ended":
      return "Call ended";
    case "error":
      return "Connection error";
    default:
      return "Idle";
  }
}

function apiBase() {
  return "";
}

function RoomShell() {
  const [roomInput, setRoomInput] = useState("");
  const navigate = useNavigate();
  const createRoom = async () => {
    const response = await fetch(`${apiBase()}/api/rooms`, { method: "POST" });
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { roomId: string };
    navigate(joinRoomPath(payload.roomId));
  };

  const joinRoom = () => {
    const roomId = extractRoomId(roomInput);
    if (!roomId) {
      return;
    }
    navigate(joinRoomPath(roomId));
  };

  return (
    <main className="app-shell">
      <section className="lobby-layout">
        <div className="brand-column">
          <p className="eyebrow">Northline Call</p>
          <h1>1v1 video, routed through Cloudflare TURN.</h1>
          <p className="lede">
            Create a room, share the link, and start a direct camera call with no account,
            no queue, and no clutter.
          </p>
          <div className="callout-row">
            <span className="meta-chip">
              <LayoutGrid size={14} />
              Single room
            </span>
            <span className="meta-chip">
              <Link2 size={14} />
              Invite link
            </span>
            <span className="meta-chip">
              <RefreshCw size={14} />
              WebRTC + TURN
            </span>
          </div>
        </div>

        <div className="surface panel">
          <div className="panel-header">
            <div>
              <p className="panel-eyebrow">Start here</p>
              <h2>Join or create a room</h2>
            </div>
          </div>

          <div className="lobby-actions">
            <button className="primary-button" type="button" onClick={createRoom}>
              <Plus size={16} />
              Create room
            </button>
            <div className="input-row">
              <input
                aria-label="Room code or invite link"
                placeholder="Paste a room code or invite link"
                value={roomInput}
                onChange={(event) => setRoomInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    joinRoom();
                  }
                }}
              />
              <button className="secondary-button" type="button" onClick={joinRoom}>
                <Link2 size={16} />
                Join
              </button>
            </div>
          </div>

          <div className="panel-footer">
            <span className="support-note">Anonymous room links. No accounts required.</span>
          </div>
        </div>
      </section>
    </main>
  );
}

function useVideoStream(videoRef: React.RefObject<HTMLVideoElement | null>, stream: MediaStream | null) {
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, videoRef]);
}

function RoomView() {
  const { roomId = "" } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<RoomConnectionState>({
    ...initialConnectionState,
    roomId,
    inviteUrl: buildInviteUrl(window.location.origin, roomId),
  });
  const [mediaReady, setMediaReady] = useState(false);
  const [localMuted, setLocalMuted] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [canCopy, setCanCopy] = useState(true);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const roleRef = useRef<RoomRole | null>(null);
  const statusRef = useRef<SessionStatus>("idle");
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const peerJoinedRef = useRef(false);
  const offerInFlightRef = useRef(false);

  useVideoStream(localVideoRef, localStreamRef.current);
  useVideoStream(remoteVideoRef, remoteStreamRef.current);

  const updateState = (patch: Partial<RoomConnectionState>) => {
    if (patch.status) {
      statusRef.current = patch.status;
    }
    setState((current) => ({ ...current, ...patch }));
  };

  const closePeerConnection = () => {
    const connection = peerConnectionRef.current;
    if (connection) {
      connection.ontrack = null;
      connection.onicecandidate = null;
      connection.onconnectionstatechange = null;
      connection.close();
    }
    peerConnectionRef.current = null;
    remoteStreamRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    offerInFlightRef.current = false;
    peerJoinedRef.current = false;
  };

  const closeSocket = () => {
    const socket = socketRef.current;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close(1000, "closed");
    }
    socketRef.current = null;
  };

  const releaseMedia = () => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    setMediaReady(false);
    setLocalMuted(false);
    setCameraEnabled(true);
  };

  const leaveCall = () => {
    const socket = socketRef.current;
    try {
      socket?.send(JSON.stringify({ type: "hangup" } satisfies ClientSignalMessage));
    } catch {
      // Ignore send errors during shutdown.
    }
    closePeerConnection();
    closeSocket();
    releaseMedia();
    updateState({
      status: "ended",
      message: "Call closed. The room link remains valid.",
      role: null,
      participantCount: 0,
    });
  };

  const sendSignal = (message: ClientSignalMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  };

  const ensurePeerConnection = async (iceServers: RTCIceServer[]) => {
    const existing = peerConnectionRef.current;
    if (existing) {
      existing.setConfiguration({ iceServers });
      return existing;
    }

    const connection = new RTCPeerConnection({ iceServers });
    peerConnectionRef.current = connection;

    const localStream = localStreamRef.current;
    if (localStream) {
      localStream.getTracks().forEach((track) => connection.addTrack(track, localStream));
    }

    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        remoteStreamRef.current = stream;
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      }
    };

    connection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal({ type: "ice-candidate", candidate: event.candidate.toJSON() });
      }
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        updateState({
          status: "connected",
          message: "Live audio and video are flowing.",
        });
      }

      if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
        updateState({
          status: "reconnecting",
          message: "Peer connection dropped. Waiting to recover.",
        });
      }
    };

    return connection;
  };

  const startOffer = async () => {
    const connection = peerConnectionRef.current ?? (await ensurePeerConnection(iceServersRef.current));
    if (!connection || offerInFlightRef.current || connection.signalingState !== "stable") {
      return;
    }

    offerInFlightRef.current = true;
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    sendSignal({ type: "offer", sdp: offer });
    offerInFlightRef.current = false;
  };

  const connect = async () => {
    updateState({ status: "getting-media", message: "Requesting camera and microphone." });

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    localStreamRef.current = mediaStream;
    setMediaReady(true);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = mediaStream;
    }

    const iceResponse = await fetch(`${apiBase()}/api/rooms/${roomId}/ice`);
    if (!iceResponse.ok) {
      throw new Error("Unable to fetch TURN credentials.");
    }

    const { iceServers } = (await iceResponse.json()) as IceServerResponse;
    iceServersRef.current = iceServers;
    await ensurePeerConnection(iceServers);

    const socketUrl = new URL(`/api/rooms/${roomId}/ws`, window.location.origin);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(socketUrl.toString());
    socketRef.current = socket;
    updateState({
      status: "connecting",
      message: "Connecting to the room.",
    });

    socket.onopen = () => {
      updateState({
        status: "waiting-for-peer",
        message: "Joined. Share the link and wait for the peer to connect.",
      });
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data as string) as ServerSignalMessage;

      if (message.type === "role") {
        roleRef.current = message.role;
        updateState({
          role: message.role,
          participantCount: message.participantCount,
          roomId: message.roomId,
          inviteUrl: buildInviteUrl(window.location.origin, message.roomId),
        });
        if (message.role === "host" && peerJoinedRef.current) {
          await startOffer();
        }
        return;
      }

      if (message.type === "room-state") {
        updateState({ participantCount: message.participantCount });
        return;
      }

      if (message.type === "peer-joined") {
        peerJoinedRef.current = true;
        updateState({
          status: "connecting",
          message: "Peer joined. Negotiating the call.",
          participantCount: message.participantCount,
        });
        if (roleRef.current === "host") {
          await startOffer();
        }
        return;
      }

      if (message.type === "peer-left") {
        peerJoinedRef.current = false;
        closePeerConnection();
        updateState({
          status: "waiting-for-peer",
          message: "Peer left. The room is still open for a reconnect.",
          participantCount: message.participantCount,
        });
        return;
      }

      if (message.type === "room-full") {
        updateState({
          status: "error",
          message: "This room already has two participants.",
        });
        leaveCall();
        return;
      }

      if (message.type === "signal") {
        const signal = message.signal;
        const connection = peerConnectionRef.current ?? (await ensurePeerConnection(iceServersRef.current));
        if (!connection) {
          return;
        }

        if (signal.type === "offer") {
          await connection.setRemoteDescription(signal.sdp);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          sendSignal({ type: "answer", sdp: answer });
          updateState({
            status: "connecting",
            message: "Answer sent. Establishing media paths.",
          });
          return;
        }

        if (signal.type === "answer") {
          await connection.setRemoteDescription(signal.sdp);
          return;
        }

        if (signal.type === "ice-candidate" && signal.candidate) {
          try {
            await connection.addIceCandidate(signal.candidate);
          } catch {
            // Ignore stale candidates during reconnects.
          }
          return;
        }

        if (signal.type === "hangup") {
          closePeerConnection();
          updateState({
            status: "ended",
            message: "Peer hung up.",
            participantCount: 1,
          });
        }
      }
    };

    socket.onclose = () => {
      if (statusRef.current !== "ended") {
        closePeerConnection();
        releaseMedia();
        updateState({
          status: "ended",
          message: "Room socket closed.",
        });
      }
    };

    socket.onerror = () => {
      updateState({
        status: "error",
        message: "Room connection error.",
      });
    };
  };

  useEffect(() => {
    return () => {
      closePeerConnection();
      closeSocket();
      releaseMedia();
    };
  }, []);

  const copyInvite = async () => {
    if (!state.inviteUrl) {
      return;
    }
    await navigator.clipboard.writeText(state.inviteUrl);
    setCanCopy(false);
    window.setTimeout(() => setCanCopy(true), 1200);
  };

  const toggleAudio = () => {
    const stream = localStreamRef.current;
    const nextMuted = !localMuted;
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setLocalMuted(nextMuted);
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    const nextEnabled = !cameraEnabled;
    stream?.getVideoTracks().forEach((track) => {
      track.enabled = nextEnabled;
    });
    setCameraEnabled(nextEnabled);
  };

  const statusLabel = useMemo(() => formatStatus(state.status), [state.status]);

  return (
    <main className="call-shell">
      <section className="call-header">
        <div className="room-summary">
          <p className="panel-eyebrow">Room</p>
          <h1>{roomId}</h1>
          <div className="callout-row">
            <span className="meta-chip">
              <Video size={14} />
              {state.participantCount} participant{state.participantCount === 1 ? "" : "s"}
            </span>
            <span className="meta-chip">
              <LayoutGrid size={14} />
              {state.role ? `Role: ${state.role}` : "Awaiting role"}
            </span>
            <span className="meta-chip">
              <RefreshCw size={14} />
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="room-actions">
          <button className="secondary-button" type="button" onClick={copyInvite} disabled={!state.inviteUrl}>
            <Copy size={16} />
            {canCopy ? "Copy link" : "Copied"}
          </button>
          <button className="primary-button" type="button" onClick={connect} disabled={mediaReady}>
            <Phone size={16} />
            {mediaReady ? "Joined" : "Join call"}
          </button>
          <button className="danger-button" type="button" onClick={leaveCall}>
            <Phone size={16} />
            Leave
          </button>
        </div>
      </section>

      <section className="call-stage">
        <article className="video-panel remote-panel">
          <div className="panel-label">Remote</div>
          <video ref={remoteVideoRef} autoPlay playsInline />
          {!remoteStreamRef.current && <div className="video-placeholder">Waiting for the peer video feed.</div>}
        </article>

        <aside className="video-panel local-panel">
          <div className="panel-label">Local</div>
          <video ref={localVideoRef} autoPlay muted playsInline />
          {!localStreamRef.current && <div className="video-placeholder">Camera is off.</div>}
        </aside>
      </section>

      <section className="control-strip">
        <div className="status-banner">
          <strong>{statusLabel}</strong>
          <span>{state.message}</span>
        </div>
        <div className="control-buttons">
          <button className="icon-button" type="button" onClick={toggleAudio} disabled={!mediaReady}>
            {localMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button className="icon-button" type="button" onClick={toggleCamera} disabled={!mediaReady}>
            {cameraEnabled ? <Camera size={18} /> : <CameraOff size={18} />}
          </button>
          <button className="icon-button" type="button" onClick={copyInvite} disabled={!state.inviteUrl}>
            <Copy size={18} />
          </button>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RoomShell />} />
      <Route path="/room/:roomId" element={<RoomView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
