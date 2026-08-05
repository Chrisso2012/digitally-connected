// DC-003-I029.1 — Mock Transport Adapter: the ONLY transport adapter this
// milestone ships, and the only one automated tests/the CLI's default
// mode use — no network dependency. This is the intended extension
// point: a future real transport provider (ChatGPT/Claude/MCP/n8n/API)
// implements the same two-method shape and can be swapped in without
// changing bridge-transport-service.mjs at all. No formal contract-checker
// file exists for this shape (unlike the Storage Adapter above) —
// deliberately lean, per this milestone's own brief; the shape is
// documented here and in bridge-transport-service.mjs's own JSDoc.
//
//   { name: string,
//     sendWorkOrder({ workOrder, destinationDir }): Promise<{ destinationPath, checksum }>,
//     receiveDeliveryReport({ sourcePath }): Promise<{ deliveryReport, checksum }> }
//
// "Export" here genuinely writes the Work Order's own JSON to a real local
// destination directory (the closest honest thing to an "Outgoing Queue"
// this milestone can build without a real remote endpoint) — a plain
// writeFileSync, not the Bridge Transport Store's own atomic-write
// discipline, since this is a disposable queue drop, not the authoritative
// record (that's what bridge-transport-store.mjs is for).

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { BridgeTransportSendError, DuplicateBridgeTransportError, BridgeTransportCorruptionError } from "./bridge-transport-errors.mjs";

function checksumOf(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * options.mode — "success" (default) | "failure" | "duplicate" (export
 *   only, simulates the remote side already having this object) |
 *   "corrupted" (import only, simulates an unreadable/corrupt payload).
 */
export function createMockBridgeTransportAdapter(options = {}) {
  const mode = options.mode ?? "success";

  return {
    name: "mock-bridge-transport-adapter",

    async sendWorkOrder({ workOrder, destinationDir }) {
      if (mode === "failure") {
        throw new BridgeTransportSendError("simulated transport failure [mock]");
      }
      if (mode === "duplicate") {
        throw new DuplicateBridgeTransportError(workOrder.work_order_id, "outgoing");
      }
      const content = JSON.stringify(workOrder);
      mkdirSync(destinationDir, { recursive: true });
      const destinationPath = path.join(destinationDir, `${workOrder.work_order_id}.json`);
      writeFileSync(destinationPath, content, "utf-8");
      return { destinationPath, checksum: checksumOf(content) };
    },

    async receiveDeliveryReport({ sourcePath }) {
      if (mode === "corrupted") {
        throw new BridgeTransportCorruptionError("simulated corrupt payload [mock]");
      }
      if (mode === "failure") {
        throw new BridgeTransportSendError("simulated transport failure [mock]");
      }
      let content;
      try {
        content = readFileSync(sourcePath, "utf-8");
      } catch (cause) {
        throw new BridgeTransportCorruptionError(`the import path could not be read (${cause.code ?? "error"})`);
      }
      let deliveryReport;
      try {
        deliveryReport = JSON.parse(content);
      } catch {
        throw new BridgeTransportCorruptionError("the import payload is not valid JSON");
      }
      return { deliveryReport, checksum: checksumOf(content) };
    },
  };
}
