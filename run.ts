import {
  getPeers,
  sendMessageToPeer,
  subscribeToPeerMessages,
  subscribeToPeers,
  type AuthenticatedLnd,
} from "lightning";
import {
  OnionMessenger,
  OnionMessage,
  Init,
  InitFeatures,
  Option_CVec_ThirtyTwoBytesZZ,
  Result_OnionMessageDecodeErrorZ_OK,
  initializeWasmFromBinary,
} from "lightningdevkit";
import { readFileSync } from "fs";

const ONION_MESSAGES_REQUIRED = 38;
const ONION_MESSAGES_OPTIONAL = 39;
const ONION_MESSAGE_TYPE = 513;

const bufferAsHex = (buffer: Uint8Array) => Buffer.from(buffer).toString("hex");
const hexAsBuffer = (hex: string) => Buffer.from(hex, "hex");

// Ensure WASM initialization
await initializeWasmFromBinary(
  readFileSync("node_modules/lightningdevkit/liblightningjs.wasm")
);

await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for 500ms

// Main function to run the onion messenger
export async function runOnionMessenger(
  peers: Map<string, boolean>,
  lnd: AuthenticatedLnd,
  messenger: OnionMessenger
): Promise<void> {
  const onionHandler = messenger.as_OnionMessageHandler();

  if (!onionHandler) {
    throw new Error("Failed to initialize OnionMessageHandler");
  }

  // Setup peer event listener
  const peerSub = subscribeToPeers({ lnd });

  peerSub.on("connected", async (peer) => {
    console.log("connected", peer);
    const pubkey = hexAsBuffer(peer.public_key);
    const supportsOnion = await checkOnionSupport(pubkey, lnd);
    const initFeatures = InitFeatures.constructor_empty();

    if (supportsOnion) {
      initFeatures.set_optional_feature_bit(ONION_MESSAGES_OPTIONAL);
    }

    const emptyCVecThirtyTwoBytes =
      Option_CVec_ThirtyTwoBytesZZ.constructor_none();

    const init = Init.constructor_new(
      initFeatures,
      emptyCVecThirtyTwoBytes,
      emptyCVecThirtyTwoBytes
    );

    onionHandler.peer_connected(pubkey, init, false);
    peers.set(bufferAsHex(pubkey), true);
  });

  peerSub.on("disconnected", (peer) => {
    console.log("disconnected", peer);
    const pubkey = hexAsBuffer(peer.public_key);
    onionHandler.peer_disconnected(pubkey);
    peers.set(bufferAsHex(pubkey), false);
  });

  peerSub.on("error", (err) => {
    console.log(err);
    peerSub.removeAllListeners();
  });

  // Setup custom message listener
  const customMessages = subscribeToPeerMessages({ lnd });
  customMessages.on("message_received", async (data) => {
    try {
      console.log(data);
      if (data.type === ONION_MESSAGE_TYPE) {
        const pubkey = hexAsBuffer(data.public_key);
        const result = OnionMessage.constructor_read(hexAsBuffer(data.message));

        if (!result.is_ok()) {
          console.log("Error reading onion message");
          return;
        }

        const onionMessage = (result as Result_OnionMessageDecodeErrorZ_OK).res;
        // console.log("OnionMessage:", onionMessage);

        onionHandler.handle_onion_message(pubkey, onionMessage);
        console.log("Onion message handled for peer:", bufferAsHex(pubkey));
      }
    } catch (err) {
      console.error("message_received error", err);
    }
  });

  customMessages.on("error", (err) => {
    console.log(err);
    customMessages.removeAllListeners();
  });

  // Periodic polling for outgoing messages
  const interval = setInterval(async () => {
    try {
      console.log("peers", Array.from(peers.entries()));
      for (const [peer, supportsOnion] of peers.entries()) {
        console.log("peer", peer);
        if (supportsOnion) {
          try {
            const peerBuffer = hexAsBuffer(peer);
            if (peerBuffer.length !== 33) {
              console.error("Invalid peer public key length");
              continue;
            }
            console.log("Checking for outgoing message for peer:", peer);
            const outgoingMessage =
              onionHandler.next_onion_message_for_peer(peerBuffer);

            console.log("Outgoing message result:", outgoingMessage);

            if (outgoingMessage) {
              await sendMessageToPeer({
                lnd,
                public_key: peer,
                type: ONION_MESSAGE_TYPE,
                message: bufferAsHex(outgoingMessage.write()),
              });
              console.log("Sent outgoing onion message to peer:", peer);
            } else {
              console.log("No outgoing message for peer:", peer);
            }
          } catch (err) {
            console.error("Error calling next_onion_message_for_peer:", err);
            console.error(
              "Error processing outgoing message for peer:",
              peer,
              err
            );
          }
        }
      }
    } catch (err) {
      console.error("interval error", err);
    }
  }, 5000);

  // Cleanup on shutdown
  const shutdown = () => {
    clearInterval(interval);
    peerSub.removeAllListeners();
    customMessages.removeAllListeners();
    console.log("Cleaned up and shutdown");
  };

  // Handle shutdown signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Utility function to check if a peer supports onion messaging
async function checkOnionSupport(
  pubkey: Uint8Array,
  lnd: AuthenticatedLnd
): Promise<boolean> {
  const peers = await getPeers({ lnd });
  const peer = peers.peers.find((p) =>
    hexAsBuffer(p.public_key).equals(pubkey)
  );
  if (
    peer &&
    peer.features.find(
      (n) =>
        n.bit === ONION_MESSAGES_REQUIRED || n.bit === ONION_MESSAGES_OPTIONAL
    )
  ) {
    return true;
  }
  return false;
}
