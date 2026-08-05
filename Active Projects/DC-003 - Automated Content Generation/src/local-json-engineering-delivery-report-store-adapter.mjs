// DC-003-I029 — Local JSON Storage Adapter for Engineering Delivery
// Reports: one file per record at `<storageDir>/<delivery_report_id>.json`.
// Mirrors local-json-engineering-work-order-store-adapter.mjs exactly.

import { writeFileSync, readFileSync, readdirSync, existsSync, renameSync, unlinkSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const EXTENSION = ".json";

export function createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir }) {
  function finalPath(identifier) {
    return path.join(storageDir, `${identifier}${EXTENSION}`);
  }

  return {
    name: "local-json-engineering-delivery-report-store",

    write(identifier, content) {
      mkdirSync(storageDir, { recursive: true });
      const target = finalPath(identifier);
      const tempPath = path.join(storageDir, `.${identifier}.tmp-${randomUUID()}${EXTENSION}`);

      writeFileSync(tempPath, content, "utf-8");

      const writtenBack = readFileSync(tempPath, "utf-8");
      if (writtenBack !== content) {
        unlinkSync(tempPath);
        throw new Error("atomic write verification failed — temp file content did not match what was written");
      }

      renameSync(tempPath, target);
    },

    read(identifier) {
      return readFileSync(finalPath(identifier), "utf-8");
    },

    list() {
      if (!existsSync(storageDir)) {
        return [];
      }
      return readdirSync(storageDir)
        .filter((name) => name.endsWith(EXTENSION) && !name.startsWith("."))
        .map((name) => name.slice(0, -EXTENSION.length));
    },

    exists(identifier) {
      return existsSync(finalPath(identifier));
    },
  };
}
