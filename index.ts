import { authenticatedLndGrpc, getPeers, getWalletInfo } from "lightning";
import {
  CustomOnionMessageHandler,
  DefaultMessageRouter,
  EntropySource,
  IgnoringMessageHandler,
  Logger,
  MessageRouter,
  Network,
  NetworkGraph,
  NodeIdLookUp,
  NodeSigner,
  OffersMessageHandler,
  OnionMessenger,
  initializeWasmFromBinary,
} from "lightningdevkit";
import {
  LndNodeSigner,
  MessengerUtilities,
  OnionLogger,
  OnionNodeIdLookUp,
  OnionOffersMessageHandler,
} from "./onion_messenger";
import { readFileSync } from "node:fs";

import { getNetwork } from "ln-sync";
import { runOnionMessenger } from "./run";

const cert = Bun.env.CERT;
const macaroon = Bun.env.MACAROON;
const socket = Bun.env.SOCKET;

const ONION_MESSAGES_REQUIRED = 38;
const ONION_MESSAGES_OPTIONAL = 39;
const hexAsBuffer = (hex: string) => Buffer.from(hex, "hex");

const peerSupport = new Map();

async function main() {
  await initializeWasmFromBinary(
    readFileSync("node_modules/lightningdevkit/liblightningjs.wasm")
  );

  try {
    const { lnd } = authenticatedLndGrpc({
      cert,
      macaroon,
      socket,
    });

    const info = await getWalletInfo({ lnd });

    const peers = await getPeers({ lnd });

    peers.peers.forEach((peer) => {
      const isOnionPeer = peer.features.find(
        (n) =>
          n.bit === ONION_MESSAGES_REQUIRED || n.bit === ONION_MESSAGES_OPTIONAL
      );
      if (isOnionPeer) {
        peerSupport.set(peer.public_key, true);
        return;
      }

      peerSupport.set(peer.public_key, false);
    });

    // Create an instance of EntropySource using the above implementation
    const entropySource = EntropySource.new_impl(new MessengerUtilities());
    const nodeSigner = NodeSigner.new_impl(
      new LndNodeSigner(hexAsBuffer(info.public_key), lnd)
    );
    const logger = Logger.new_impl(new OnionLogger());
    const nodeIdLookup = NodeIdLookUp.new_impl(
      new OnionNodeIdLookUp(hexAsBuffer(info.public_key), lnd)
    );

    const network = await getNetwork({ lnd });

    // Convert bitcoinjs network to LDK Network enum
    const ldkNetwork = getLDKNetwork(network.bitcoinjs);

    // Create an instance of NetworkGraph
    const networkGraph = NetworkGraph.constructor_new(ldkNetwork, logger);

    // Create an instance of DefaultMessageRouter
    const messageRouter = DefaultMessageRouter.constructor_new(
      networkGraph,
      entropySource
    );

    const offersMessageHandler = OffersMessageHandler.new_impl(
      new OnionOffersMessageHandler()
    );

    const ignoreMessageHandler = IgnoringMessageHandler.constructor_new();

    // Cast the messageRouter instance to the correct type
    const messenger = OnionMessenger.constructor_new(
      entropySource,
      nodeSigner,
      logger,
      nodeIdLookup,
      messageRouter.as_MessageRouter(),
      offersMessageHandler,
      ignoreMessageHandler.as_CustomOnionMessageHandler()
    );

    const onionHandler = messenger.as_OnionMessageHandler();

    if (!onionHandler) {
      throw new Error("Failed to initialize OnionMessageHandler");
    }

    await runOnionMessenger(peerSupport, lnd, messenger);

    console.log("reaching here", peerSupport);
  } catch (error) {
    console.log("error starting onion messenger", error);
  }
}

main();

function getLDKNetwork(bitcoinjsNetwork: string): Network {
  switch (bitcoinjsNetwork) {
    case "mainnet":
      return Network.LDKNetwork_Bitcoin;
    case "testnet":
      return Network.LDKNetwork_Testnet;
    case "regtest":
      return Network.LDKNetwork_Regtest;
    case "signet":
      return Network.LDKNetwork_Signet;
    default:
      throw new Error(`Unknown bitcoinjs network: ${bitcoinjsNetwork}`);
  }
}
