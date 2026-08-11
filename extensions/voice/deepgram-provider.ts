import { spawn } from "node:child_process";

import { createProvider, type ApiKeyAuth, type ProviderStreams } from "@earendil-works/pi-ai";

const KEYCHAIN_ACCOUNT = "pi-listen";
const KEYCHAIN_SERVICE = "com.codexstar.pi-listen.deepgram";
export const DEEPGRAM_KEYCHAIN_COMMAND =
	`!/usr/bin/security find-generic-password -a ${KEYCHAIN_ACCOUNT} -s ${KEYCHAIN_SERVICE} -w`;

const STORE_KEY_SWIFT = String.raw`
import Foundation
import Security

let account = CommandLine.arguments[1]
let service = CommandLine.arguments[2]
let secret = FileHandle.standardInput.readDataToEndOfFile()
guard !secret.isEmpty else {
  FileHandle.standardError.write(Data("empty secret\n".utf8))
  exit(2)
}

let query: [String: Any] = [
  kSecClass as String: kSecClassGenericPassword,
  kSecAttrAccount as String: account,
  kSecAttrService as String: service,
]
let values: [String: Any] = [
  kSecValueData as String: secret,
  kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
]
var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
if status == errSecItemNotFound {
  var item = query
  for (key, value) in values { item[key] = value }
  status = SecItemAdd(item as CFDictionary, nil)
}
guard status == errSecSuccess else {
  FileHandle.standardError.write(Data("Keychain error \(status)\n".utf8))
  exit(1)
}
`;

type StoreKey = (key: string, signal: AbortSignal) => Promise<void>;

export function storeDeepgramKeyInKeychain(key: string, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"/usr/bin/swift",
			["-e", STORE_KEY_SWIFT, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE],
			{ stdio: ["pipe", "ignore", "pipe"] },
		);
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = (stderr + chunk.toString()).slice(-1000);
		});
		const abort = () => child.kill("SIGTERM");
		signal.addEventListener("abort", abort, { once: true });
		child.once("error", reject);
		child.once("close", (code) => {
			signal.removeEventListener("abort", abort);
			if (signal.aborted) {
				reject(signal.reason);
			} else if (code === 0) {
				resolve();
			} else {
				reject(new Error(stderr.trim() || `Keychain helper exited with code ${code}`));
			}
		});
		child.stdin.end(key);
	});
}

export function createDeepgramApiKeyAuth(options: {
	platform?: NodeJS.Platform;
	storeKey?: StoreKey;
} = {}): ApiKeyAuth {
	const platform = options.platform ?? process.platform;
	const storeKey = options.storeKey ?? storeDeepgramKeyInKeychain;

	return {
		name: "Deepgram API key",
		async login(interaction) {
			const key = await interaction.prompt({
				type: "secret",
				message: "Enter Deepgram API key",
			});
			interaction.signal.throwIfAborted();
			if (platform !== "darwin") return { type: "api_key", key };

			interaction.notify({ type: "progress", message: "Saving to macOS Keychain..." });
			await storeKey(key, interaction.signal);
			return { type: "api_key", key: DEEPGRAM_KEYCHAIN_COMMAND };
		},
		async resolve({ ctx, credential, signal }) {
			signal.throwIfAborted();
			if (credential?.key) {
				return { auth: { apiKey: credential.key }, source: "stored credential" };
			}
			const key = await ctx.env("DEEPGRAM_API_KEY");
			signal.throwIfAborted();
			return key ? { auth: { apiKey: key }, source: "DEEPGRAM_API_KEY" } : undefined;
		},
	};
}

export function createDeepgramProvider() {
	return createProvider({
		id: "deepgram",
		name: "Deepgram",
		baseUrl: "https://api.deepgram.com",
		auth: { apiKey: createDeepgramApiKeyAuth() },
		models: [],
		api: {} as ProviderStreams,
	});
}
