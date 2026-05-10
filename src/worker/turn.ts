import { sanitizeIceServers, type TurnIceServerResponse } from "../shared/turn";

export type TurnServiceEnv = {
  TURN_KEY_ID: string;
  TURN_KEY_API_TOKEN: string;
  TURN_TTL_SECONDS: number;
};

export async function generateTurnIceServers(env: TurnServiceEnv) {
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: env.TURN_TTL_SECONDS }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TURN credential generation failed: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as TurnIceServerResponse;
  return sanitizeIceServers(payload.iceServers);
}
