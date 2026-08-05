// DC-003-I029.1 — CLI for Bridge Transport. Mock-only, no networking
// anywhere in this file — every subcommand only ever reads/writes local
// JSON stores and a local destination/source file path.
//
// Usage:
//   node tests/validation/bridge.mjs export <workOrderId> <workOrderStoreDirectory> <transportStoreDirectory> <destinationDir>
//   node tests/validation/bridge.mjs import <deliveryReportPath> <deliveryReportStoreDirectory> <transportStoreDirectory>
//   node tests/validation/bridge.mjs queue <transportStoreDirectory>
//   node tests/validation/bridge.mjs history <transportStoreDirectory>
//
//   or: npm run bridge -- <subcommand> ...

import { createLocalJsonEngineeringWorkOrderStoreAdapter } from "../../src/local-json-engineering-work-order-store-adapter.mjs";
import { createEngineeringWorkOrderStore } from "../../src/engineering-work-order-store.mjs";
import {
  EngineeringWorkOrderNotFoundError,
  InvalidEngineeringWorkOrderIdentifierError,
  CorruptedEngineeringWorkOrderError,
} from "../../src/engineering-work-order-errors.mjs";
import { createLocalJsonEngineeringDeliveryReportStoreAdapter } from "../../src/local-json-engineering-delivery-report-store-adapter.mjs";
import { createEngineeringDeliveryReportStore } from "../../src/engineering-delivery-report-store.mjs";
import { EngineeringDeliveryReportAlreadyExistsError } from "../../src/engineering-delivery-report-errors.mjs";
import { createLocalJsonBridgeTransportStoreAdapter } from "../../src/local-json-bridge-transport-store-adapter.mjs";
import { createBridgeTransportStore } from "../../src/bridge-transport-store.mjs";
import { createMockBridgeTransportAdapter } from "../../src/bridge-transport-mock-adapter.mjs";
import { exportWorkOrder, importDeliveryReport, getQueue, getHistory } from "../../src/bridge-transport-service.mjs";
import {
  InvalidBridgeTransportStoreAdapterError,
  InvalidBridgeTransportRecordIdentifierError,
  CorruptedBridgeTransportRecordError,
  BridgeTransportPersistenceError,
  BridgeTransportSendError,
  BridgeTransportCorruptionError,
  DuplicateBridgeTransportError,
} from "../../src/bridge-transport-errors.mjs";

const KNOWN_ERRORS = [
  EngineeringWorkOrderNotFoundError,
  InvalidEngineeringWorkOrderIdentifierError,
  CorruptedEngineeringWorkOrderError,
  EngineeringDeliveryReportAlreadyExistsError,
  InvalidBridgeTransportStoreAdapterError,
  InvalidBridgeTransportRecordIdentifierError,
  CorruptedBridgeTransportRecordError,
  BridgeTransportPersistenceError,
  BridgeTransportSendError,
  BridgeTransportCorruptionError,
  DuplicateBridgeTransportError,
];

function usageAndExit() {
  console.error("Usage:");
  console.error("  node tests/validation/bridge.mjs export <workOrderId> <workOrderStoreDirectory> <transportStoreDirectory> <destinationDir>");
  console.error("  node tests/validation/bridge.mjs import <deliveryReportPath> <deliveryReportStoreDirectory> <transportStoreDirectory>");
  console.error("  node tests/validation/bridge.mjs queue <transportStoreDirectory>");
  console.error("  node tests/validation/bridge.mjs history <transportStoreDirectory>");
  process.exit(1);
}

function printHistoryLine(summary) {
  console.log(
    `  [${summary.transport_record_id}] ${summary.direction.padEnd(8)} ${summary.object_type.padEnd(25)} ${summary.object_id} ` +
      `status=${summary.status.padEnd(9)} at=${summary.transported_at}`
  );
}

const [subcommand, ...rest] = process.argv.slice(2);
if (!subcommand) usageAndExit();

try {
  if (subcommand === "export") {
    const [workOrderId, workOrderStoreDirectory, transportStoreDirectory, destinationDir] = rest;
    if (!workOrderId || !workOrderStoreDirectory || !transportStoreDirectory || !destinationDir) usageAndExit();

    const workOrderStore = createEngineeringWorkOrderStore({ adapter: createLocalJsonEngineeringWorkOrderStoreAdapter({ storageDir: workOrderStoreDirectory }) });
    const transportStore = createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: transportStoreDirectory }) });
    const result = await exportWorkOrder(
      { workOrderId, destinationDir },
      { workOrderStore, transportStore, adapter: createMockBridgeTransportAdapter() }
    );
    console.log("Export complete");
    console.log(`  transport_record_id: ${result.transportRecordId}`);
    console.log(`  work_order_id:       ${result.workOrderId}`);
    console.log(`  destination_path:    ${result.destinationPath}`);
    console.log(`  status:              ${result.status}`);
  } else if (subcommand === "import") {
    const [deliveryReportPath, deliveryReportStoreDirectory, transportStoreDirectory] = rest;
    if (!deliveryReportPath || !deliveryReportStoreDirectory || !transportStoreDirectory) usageAndExit();

    const deliveryReportStore = createEngineeringDeliveryReportStore({
      adapter: createLocalJsonEngineeringDeliveryReportStoreAdapter({ storageDir: deliveryReportStoreDirectory }),
    });
    const transportStore = createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: transportStoreDirectory }) });
    const result = await importDeliveryReport(
      { sourcePath: deliveryReportPath },
      { deliveryReportStore, transportStore, adapter: createMockBridgeTransportAdapter() }
    );
    console.log("Import complete");
    console.log(`  transport_record_id: ${result.transportRecordId}`);
    console.log(`  delivery_report_id:  ${result.deliveryReportId}`);
    console.log(`  status:              ${result.status}`);
  } else if (subcommand === "queue") {
    const [transportStoreDirectory] = rest;
    if (!transportStoreDirectory) usageAndExit();
    const transportStore = createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: transportStoreDirectory }) });
    const queue = getQueue({ transportStore });
    console.log("Bridge Queue");
    console.log(`  pending_exports: ${queue.pending_exports}`);
    console.log(`  pending_imports: ${queue.pending_imports}`);
    console.log(`  delivered:       ${queue.delivered}`);
    console.log(`  rejected:        ${queue.rejected}`);
    console.log(`  history_count:   ${queue.history_count}`);
    console.log(`  last_transport:  ${queue.last_transport?.transport_record_id ?? "(none)"}`);
  } else if (subcommand === "history") {
    const [transportStoreDirectory] = rest;
    if (!transportStoreDirectory) usageAndExit();
    const transportStore = createBridgeTransportStore({ adapter: createLocalJsonBridgeTransportStoreAdapter({ storageDir: transportStoreDirectory }) });
    const history = getHistory({ transportStore });
    console.log(`${history.length} transport record(s)`);
    for (const summary of history) printHistoryLine(summary);
  } else {
    usageAndExit();
  }
  process.exit(0);
} catch (error) {
  if (KNOWN_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else {
    throw error;
  }
  process.exit(1);
}
