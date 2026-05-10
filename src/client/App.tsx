import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  CameraOff,
  Copy,
  Link2,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Plus,
  Share2,
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
  message: "Ready.",
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
      return "Getting ready";
    case "connecting":
      return "Connecting";
    case "waiting-for-peer":
      return "Waiting";
    case "connected":
      return "Live";
    case "reconnecting":
      return "Reconnecting";
    case "ended":
      return "Ended";
    case "error":
      return "Error";
    default:
      return "Ready";
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
    <main className="lobby-screen">
      <section className="lobby-shell" aria-label="Call start screen">
        <div className="lobby-brand">
          <h1>Met</h1>
          <p className="lobby-copy">Start or join a call.</p>
        </div>

        <div className="lobby-panel">
          <button className="lobby-primary" type="button" onClick={createRoom}>
            <Plus size={18} />
            Start
          </button>

          <div className="lobby-join">
            <input
              aria-label="Paste link"
              placeholder="Paste link"
              value={roomInput}
              onChange={(event) => setRoomInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  joinRoom();
                }
              }}
            />
            <button className="lobby-join-button" type="button" onClick={joinRoom}>
              <Link2 size={16} />
              Join
            </button>
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
  const [localVideoReady, setLocalVideoReady] = useState(false);
  const [remoteVideoReady, setRemoteVideoReady] = useState(false);
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
    setRemoteVideoReady(false);
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
    setLocalVideoReady(false);
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

  const returnHome = () => {
    leaveCall();
    navigate("/", { replace: true });
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
        setRemoteVideoReady(true);
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
    updateState({ status: "getting-media", message: "Getting ready." });

    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    localStreamRef.current = mediaStream;
    setLocalVideoReady(true);
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
      message: "Connecting.",
    });

    socket.onopen = () => {
      updateState({
        status: "waiting-for-peer",
        message: "Waiting.",
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
          message: "Connecting.",
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
          message: "Waiting.",
          participantCount: message.participantCount,
        });
        return;
      }

      if (message.type === "room-full") {
        updateState({
          status: "error",
          message: "Room full.",
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
            message: "Connecting.",
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
            message: "Ended.",
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
          message: "Ended.",
        });
      }
    };

    socket.onerror = () => {
      updateState({
        status: "error",
        message: "Error.",
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
    <main className="call-screen">
      <video
        ref={remoteVideoRef}
        className="remote-stage"
        autoPlay
        playsInline
        hidden={!remoteVideoReady}
      />
      {!remoteVideoReady && (
        <div className="remote-empty" aria-hidden="true">
          <div className="remote-empty-card">
            <strong>{state.participantCount > 0 ? "Connecting" : "Waiting"}</strong>
          </div>
        </div>
      )}

      <div className="call-overlay">
        <header className="call-topbar">
          <button
            className="home-pill"
            type="button"
            onClick={returnHome}
            aria-label="Back to home"
            title="Back to home"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="call-branding">
            <span className="call-subtle">{statusLabel}</span>
          </div>

          <button
            className="share-pill"
            type="button"
            onClick={copyInvite}
            disabled={!state.inviteUrl}
            aria-label={canCopy ? "Share link" : "Copied"}
            title={canCopy ? "Share link" : "Copied"}
          >
            <Share2 size={16} />
          </button>
        </header>

        <aside className="local-tile">
          <div className="tile-label">Me</div>
          <video ref={localVideoRef} autoPlay muted playsInline hidden={!localVideoReady} />
          {!localVideoReady && <div className="tile-placeholder">No video</div>}
        </aside>

        <footer className="call-dock" aria-label="Call controls">
          <button className="dock-button" type="button" onClick={toggleAudio} disabled={!mediaReady}>
            {localMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button className="dock-button" type="button" onClick={toggleCamera} disabled={!mediaReady}>
            {cameraEnabled ? <Camera size={20} /> : <CameraOff size={20} />}
          </button>
          {!mediaReady ? (
            <button className="dock-button dock-button--join" type="button" onClick={connect}>
              <PhoneCall size={20} />
              Join
            </button>
          ) : (
            <button className="dock-button dock-button--hangup" type="button" onClick={leaveCall}>
              <PhoneOff size={20} />
              Leave
            </button>
          )}
          <button
            className="dock-button"
            type="button"
            onClick={copyInvite}
            disabled={!state.inviteUrl}
            aria-label={canCopy ? "Share link" : "Copied"}
            title={canCopy ? "Share link" : "Copied"}
          >
            <Copy size={20} />
          </button>
        </footer>
      </div>
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
