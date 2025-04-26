import { parseArgs } from 'node:util';
import { EyePop } from '@eyepop.ai/eyepop';
import { WorkflowPhase } from '@eyepop.ai/eyepop'
import { pino } from 'pino';
import process from 'process';

const logger = pino({ level: 'debug', name: 'eyepop-example' });

const { positionals, values } = parseArgs({
  options: {
    accountUuid: {
      type: 'string',
      short: 'a',
    },
    datasetUuids: {
      type: 'string',
      short: 'd',
    },
    modelUuids: {
      type: 'string',
      short: 'm',
    },
    phases: {
      type: 'string',
      short: 'p',
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
  },
});

function printHelpAndExit(message?: string, exitCode: number = -1) {
  if (message) {
    console.error(message);
  }
  console.info(
    'EyePop example, usage: ' +
      '\n\t-a or --accountUuid=[uuid]' +
      '\n\t-d or --datasetUuids=[comma-separated uuids] (optional)' +
      '\n\t-m or --modelUuids=[comma-separated uuids] (optional)' +
      '\n\t-p or --phases=[comma-separated phases] (optional)' +
      '\n\t-h --help to print this help message'
  );
  process.exit(exitCode);
}

(async (parameters = values) => {
  if (parameters.help || !parameters.accountUuid) {
    printHelpAndExit(undefined, 0);
  } else {
    const datasetUuids = parameters.datasetUuids?.split(',') || undefined;
    const modelUuids = parameters.modelUuids?.split(',') || undefined;
    const phases = parameters.phases?.split(',') || undefined;

    const endpoint = await EyePop.dataEndpoint({
      logger: logger,
    }).connect();

    try {
      const workflows = await endpoint.listWorkflows(
        parameters.accountUuid,
        datasetUuids,
        modelUuids,
        phases as WorkflowPhase[]
      );
      console.log(`Workflows: ${JSON.stringify(workflows, null, 2)}`);
    } finally {
      await endpoint.disconnect();
    }
  }
})();
