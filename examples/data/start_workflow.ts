import { parseArgs } from 'node:util';
import {CreateWorkflow, EyePop } from '@eyepop.ai/eyepop'
import { pino } from 'pino'
import process from "process";
import { waitForDebugger } from 'node:inspector';

const logger = pino({ level: 'debug', name: 'eyepop-example' })

const { positionals, values } = parseArgs({
  options: {
    accountUuid: {
      type: "string",
      short: "a"
    },
    datasetUuid: {
      type: "string",
      short: "d"
    },
    templateName: {
      type: "string",
      short: "t"
    },
    config: {
      type: "string",
      short: "c"
    },
    waitUntilDone: {
      type: "boolean",
      short: "w",
      default: true
    },
    help: {
      type: "boolean",
      short: "h",
      default: false
    }
  },
});

function printHelpAndExit(message?: string, exitCode: number = -1) {
    if (message) {
      console.error(message);

    }
    console.info("EyePop example, usage: " +
        "\n\t--accountUuid=[uuid]" +
        "\n\t--datasetUuid=[uuid]" +
        "\n\t--templateName=image-contents-latest" +
        "\n\t--config=\'{\"evaluator\": {\"model\": {\"prompt\": \"What is in image\"} } }\' (optional)" +
        "\n\t--help to print this help message")
    process.exit(exitCode);
}

(async (parameters=values) => {
  if (parameters.help || !parameters.accountUuid || !parameters.datasetUuid || !parameters.templateName) {
    printHelpAndExit(undefined, 0);
  } else {
      const config = parameters.config?JSON.parse(parameters.config): undefined
      const endpoint = await EyePop.dataEndpoint({
          logger: logger,
      }).connect()
      try {
          const workflow = await endpoint.startWorkflow(
              parameters.accountUuid,
              parameters.templateName, {
                  parameters: {
                      dataset_uuid: parameters.datasetUuid,
                      config: config
                  }
              }
          )
          console.log(`workflow started: ${JSON.stringify(workflow)}`)

          if (parameters.waitUntilDone) {
            let workflowStatus;
            do {
              await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for 5 seconds before checking again
              workflowStatus = await endpoint.getWorkflow(workflow.workflow_id, parameters.accountUuid);
              console.log(`Waiting for workflow to complete. Workflow status: ${JSON.stringify(workflowStatus, null, 2)}`);
              if (workflowStatus.phase === 'Succeeded' || workflowStatus.phase === 'Failed') {
                break;
              }
            } while (true);

            console.log(`Workflow completed with phase: ${workflowStatus.phase}`);
          }
      } finally {
          await endpoint.disconnect()
      }
  }
})()
