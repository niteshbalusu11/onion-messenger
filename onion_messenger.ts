import {
  Option_BigEndianScalarZ,
  Option_BigEndianScalarZ_Some,
  Result_ECDSASignatureNoneZ,
  Result_RecoverableSignatureNoneZ,
  Result_SchnorrSignatureNoneZ,
  Result_ThirtyTwoBytesNoneZ,
  UnsignedBolt12Invoice,
  UnsignedGossipMessage,
  UnsignedInvoiceRequest,
  type EntropySourceInterface,
  Record,
  type NodeIdLookUpInterface,
  type OffersMessageHandlerInterface,
  OffersMessage,
  Option_OffersMessageZ,
  ThreeTuple_OffersMessageDestinationBlindedPathZ,
  type LoggerInterface,
  ExpandedKey,
  InvoiceError,
  UntrustedString,
  BlindedPath,
  Destination,
  OffersMessage_Invoice,
  OffersMessage_InvoiceError,
  OffersMessage_InvoiceRequest,
} from "lightningdevkit";
import { randomBytes } from "crypto";
import {
  type NodeSignerInterface,
  Recipient,
  Result_PublicKeyNoneZ,
} from "lightningdevkit";
import { publicKeyTweakMul } from "secp256k1";
import type { UInt5 } from "lightningdevkit/structs/CommonBase.d.mts";
import {
  diffieHellmanComputeSecret,
  getChannel,
  type AuthenticatedLnd,
} from "lightning";
import deasync from "deasync";

const bufferAsHex = (buffer: Uint8Array) => Buffer.from(buffer).toString("hex");
const hexAsBuffer = (hex: string) => Buffer.from(hex, "hex");
const bigIntAsHex = (bigInt: bigint) => bigInt.toString(16);

export class MessengerUtilities implements EntropySourceInterface {
  get_secure_random_bytes(): Uint8Array {
    console.log("get_secure_random_bytes called");
    return randomBytes(32);
  }
}

export class OnionLogger implements LoggerInterface {
  log(record: Record) {
    console.log("log called");
    const argsStr = record.get_args();
    const level = record.get_level().toString();
    switch (level) {
      case "Gossip":
        break;
      case "Trace":
        console.trace(argsStr);
        break;
      case "Debug":
        console.debug(argsStr);
        break;
      case "Info":
        console.info(argsStr);
        break;
      case "Warn":
        console.warn(argsStr);
        break;
      case "Error":
        console.error(argsStr);
        break;
      default:
        console.log(argsStr);
        break;
    }
  }
}

export class LndNodeSigner implements NodeSignerInterface {
  private pubkey: Uint8Array;
  private lnd: AuthenticatedLnd;

  constructor(pubkey: Uint8Array, lnd: AuthenticatedLnd) {
    this.pubkey = pubkey;
    this.lnd = lnd;
  }

  get_node_id(recipient: Recipient): Result_PublicKeyNoneZ {
    console.log("get_node_id called");
    if (recipient === Recipient.LDKRecipient_PhantomNode) {
      return Result_PublicKeyNoneZ.constructor_err();
    } else {
      return Result_PublicKeyNoneZ.constructor_ok(this.pubkey);
    }
  }

  ecdh(
    recipient: Recipient,
    other_key: Uint8Array,
    tweak?: Option_BigEndianScalarZ
  ): Result_ThirtyTwoBytesNoneZ {
    console.log("ecdh called");
    if (recipient === Recipient.LDKRecipient_PhantomNode) {
      return Result_ThirtyTwoBytesNoneZ.constructor_err();
    }

    console.log("ecdh called with other_key:", other_key);

    let tweakedKey = other_key;

    if (tweak instanceof Option_BigEndianScalarZ_Some) {
      const bigEndianScalar = tweak.some;
      const tweakBytes = bigEndianScalar.scalar_bytes;
      const tweaked = publicKeyTweakMul(tweakedKey, tweakBytes);
      if (!tweaked) {
        return Result_ThirtyTwoBytesNoneZ.constructor_err();
      }
      tweakedKey = tweaked;
    }

    console.log("ecdh tweakedKey:", tweakedKey);

    let result: Result_ThirtyTwoBytesNoneZ;
    let done = false;

    diffieHellmanComputeSecret({
      lnd: this.lnd,
      partner_public_key: bufferAsHex(tweakedKey),
    })
      .then((resp) => {
        console.log("ecdh resp:", resp);

        result = Result_ThirtyTwoBytesNoneZ.constructor_ok(
          hexAsBuffer(resp.secret)
        );

        console.log("ecdh result:", result);
        done = true;
      })
      .catch((err) => {
        console.error("node signererror", err);
        result = Result_ThirtyTwoBytesNoneZ.constructor_err();
        done = true;
      });

    while (!done) {
      deasync.sleep(100);
    }

    return result!;
  }

  get_inbound_payment_key_material(): Uint8Array {
    console.log("get_inbound_payment_key_material called");
    return new Uint8Array(32);
  }

  sign_invoice(
    hrp_bytes: Uint8Array,
    invoice_data: UInt5[],
    recipient: Recipient
  ): Result_RecoverableSignatureNoneZ {
    console.log("sign_invoice called");
    return Result_RecoverableSignatureNoneZ.constructor_err();
  }

  sign_bolt12_invoice_request(
    invoice_request: UnsignedInvoiceRequest
  ): Result_SchnorrSignatureNoneZ {
    console.log("sign_bolt12_invoice_request called");
    return Result_SchnorrSignatureNoneZ.constructor_err();
  }

  sign_bolt12_invoice(
    invoice: UnsignedBolt12Invoice
  ): Result_SchnorrSignatureNoneZ {
    console.log("sign_bolt12_invoice called");
    return Result_SchnorrSignatureNoneZ.constructor_err();
  }

  sign_gossip_message(msg: UnsignedGossipMessage): Result_ECDSASignatureNoneZ {
    console.log("sign_gossip_message called");
    return Result_ECDSASignatureNoneZ.constructor_err();
  }
}

export class OnionNodeIdLookUp implements NodeIdLookUpInterface {
  private pubkey: Uint8Array;
  private lnd: AuthenticatedLnd;

  constructor(pubkey: Uint8Array, lnd: AuthenticatedLnd) {
    this.pubkey = pubkey;
    this.lnd = lnd;
  }

  next_node_id(short_channel_id: bigint): Uint8Array {
    console.log("next_node_id called");
    let result: Uint8Array;
    let done = false;

    getChannel({
      lnd: this.lnd,
      id: bigIntAsHex(short_channel_id),
    })
      .then((resp) => {
        const hexPubkey = resp.policies.find(
          (n) => n.public_key !== bufferAsHex(this.pubkey)
        )?.public_key;

        if (hexPubkey) {
          result = hexAsBuffer(hexPubkey);
          done = true;
          return;
        }
        done = true;
      })
      .catch((err) => {
        console.error("node id look up error", err);
        result = new Uint8Array(32);
        done = true;
      });

    while (!done) {
      deasync.sleep(100);
    }

    return result!;
  }
}

/**
 * An [`OnionMessage`] for [`OnionMessenger`] to send.
 *
 * These are obtained when released from [`OnionMessenger`]'s handlers after which they are
 * enqueued for sending.
 */
export class PendingOnionMessage {
  contents: OffersMessage;
  destination: Destination;
  reply_path: BlindedPath;

  constructor(
    contents: OffersMessage,
    destination: Destination,
    reply_path: BlindedPath
  ) {
    this.contents = contents;
    this.destination = destination;
    this.reply_path = reply_path;
  }
}

class PaymentInfo {
  state: string;
  invoice: any | null;

  constructor() {
    this.state = "Initial";
    this.invoice = null;
  }
}

export class OnionOffersMessageHandler
  implements OffersMessageHandlerInterface
{
  private activePayments: Map<string, PaymentInfo>;
  private pendingMessages: Array<PendingOnionMessage>;
  private messengerUtils: MessengerUtilities;
  private expandedKey: ExpandedKey;

  constructor() {
    this.activePayments = new Map();
    this.pendingMessages = [];
    this.messengerUtils = new MessengerUtilities();
    const randomBytes = this.messengerUtils.get_secure_random_bytes();
    this.expandedKey = ExpandedKey.constructor_new(randomBytes);
  }

  handle_message(message: OffersMessage): Option_OffersMessageZ {
    console.log("handle_message called with message:", message);

    if (message instanceof OffersMessage_InvoiceRequest) {
      console.error("Invoice request received, payment not yet supported.");
      return Option_OffersMessageZ.constructor_none();
    } else if (message instanceof OffersMessage_Invoice) {
      console.info("Received an invoice:", message);
      const invoice = message.invoice;

      const verifyResult = invoice.verify(this.expandedKey);
      if (verifyResult.is_ok()) {
        const paymentId = verifyResult.res;
        console.info(
          `Successfully verified invoice for payment_id ${paymentId}`
        );
        let payInfo =
          this.activePayments.get(paymentId.toString()) || new PaymentInfo();
        if (payInfo.invoice) {
          console.error("We already received an invoice with this payment id.");
        } else {
          payInfo.state = "InvoiceReceived";
          payInfo.invoice = invoice;
          this.activePayments.set(paymentId.toString(), payInfo);
        }
        return Option_OffersMessageZ.constructor_some(message);
      } else {
        console.error("Invoice verification failed for invoice:", message);
        return Option_OffersMessageZ.constructor_some(
          OffersMessage.constructor_invoice_error(
            InvoiceError.constructor_new(
              null,
              UntrustedString.constructor_new("invoice verification failure")
            )
          )
        );
      }
    } else if (message instanceof OffersMessage_InvoiceError) {
      console.error("Invoice error received:", message);
      return Option_OffersMessageZ.constructor_none();
    } else {
      console.error("Unknown message type:", message);
      return Option_OffersMessageZ.constructor_none();
    }
  }

  release_pending_messages(): ThreeTuple_OffersMessageDestinationBlindedPathZ[] {
    const messages = this.pendingMessages.slice();
    this.pendingMessages.length = 0;
    console.log("release_pending_messages called, messages:", messages);

    return messages.map((msg) => {
      return ThreeTuple_OffersMessageDestinationBlindedPathZ.constructor_new(
        msg.contents,
        msg.destination,
        msg.reply_path
      );
    });
  }
}
