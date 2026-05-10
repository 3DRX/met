import { describe, expect, it, vi } from "vitest";
import { generateTurnIceServers } from "./turn";

describe("generateTurnIceServers", () => {
  it("requests Cloudflare credentials and filters blocked 53 URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        iceServers: [
          { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
          {
            urls: [
              "turn:turn.cloudflare.com:3478?transport=udp",
              "turn:turn.cloudflare.com:53?transport=udp",
              "turns:turn.cloudflare.com:443?transport=tcp",
            ],
            username: "user",
            credential: "cred",
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const servers = await generateTurnIceServers({
      TURN_KEY_ID: "key-1",
      TURN_KEY_API_TOKEN: "token-1",
      TURN_TTL_SECONDS: 3600,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-1/credentials/generate-ice-servers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer token-1",
        }),
      }),
    );
    expect(servers).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "user",
        credential: "cred",
      },
    ]);
  });
});
