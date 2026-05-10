export type TurnIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type TurnIceServerResponse = {
  iceServers: TurnIceServer[];
};

const BLOCKED_PORT_PATTERN = /:53(?=[/?]|$)/;

function normalizeUrls(urls: string | string[]) {
  return (Array.isArray(urls) ? urls : [urls]).filter((url) => !BLOCKED_PORT_PATTERN.test(url));
}

export function sanitizeIceServers(iceServers: TurnIceServer[]) {
  return iceServers
    .map((server) => ({
      ...server,
      urls: normalizeUrls(server.urls),
    }))
    .filter((server) => server.urls.length > 0);
}
