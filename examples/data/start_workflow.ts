import { parseArgs } from 'node:util';
import {CreateWorkflow, EyePop } from '@eyepop.ai/eyepop'
import { pino } from 'pino'
import process from "process";

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
        "\n\t-a or --accountUuid=[uuid]" +
        "\n\t-d or --datasetUuid=[uuid]" +
        "\n\t-t or --templateName=[uuid]" +
        "\n\t-c or --config=JSON (optional)" +
        "\n\t-h --help to print this help message")
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
      } finally {
          await endpoint.disconnect()
      }
  }
})()
