import { describe, expect, test } from "bun:test";

import {
	createDeepgramApiKeyAuth,
	DEEPGRAM_KEYCHAIN_COMMAND,
} from "../extensions/voice/deepgram-provider";

function interaction(key: string) {
	const events: unknown[] = [];
	return {
		events,
		value: {
			signal: new AbortController().signal,
			prompt: async () => key,
			notify: (event: unknown) => events.push(event),
		},
	};
}

describe("Deepgram provider auth", () => {
	test("stores macOS login keys in Keychain", async () => {
		const stored: string[] = [];
		const auth = createDeepgramApiKeyAuth({
			platform: "darwin",
			storeKey: async (key) => stored.push(key),
		});
		const login = interaction("secret-key");

		const credential = await auth.login!(login.value);

		expect(stored).toEqual(["secret-key"]);
		expect(credential).toEqual({ type: "api_key", key: DEEPGRAM_KEYCHAIN_COMMAND });
		expect(login.events).toHaveLength(1);
	});

	test("keeps the standard Pi credential flow on other platforms", async () => {
		const auth = createDeepgramApiKeyAuth({ platform: "linux" });

		const credential = await auth.login!(interaction("secret-key").value);

		expect(credential).toEqual({ type: "api_key", key: "secret-key" });
	});

	test("prefers a stored credential over the environment", async () => {
		const auth = createDeepgramApiKeyAuth();
		const result = await auth.resolve({
			ctx: { env: async () => "environment-key" } as any,
			credential: { type: "api_key", key: "stored-key" },
			signal: new AbortController().signal,
		});

		expect(result?.auth.apiKey).toBe("stored-key");
		expect(result?.source).toBe("stored credential");
	});
});
