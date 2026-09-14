#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {freezeRun, gateRun, prepareRun, retryRun, runRuntime, validateSpec} from './engine.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = {command};
  for (let index = 0; index < rest.length; index += 2) {
    args[rest[index].replace(/^--/, '')] = rest[index + 1];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
let result;

if (args.command === 'prepare') {
  if (!args.input || !args['output-root'] || !args['pack-root']) throw new Error('prepare requires --input, --output-root, and --pack-root');
  result = prepareRun(JSON.parse(readFileSync(resolve(args.input), 'utf8')), {
    packRoot: resolve(args['pack-root']),
    outputRoot: resolve(args['output-root']),
    runId: args['run-id'],
    parentRunId: args['parent-run-id'] ?? '',
    retryStage: args['retry-stage'] ?? ''
  });
} else if (args.command === 'spec') {
  result = validateSpec(resolve(args['run-dir']));
} else if (args.command === 'runtime') {
  result = await runRuntime(resolve(args['run-dir']));
} else if (args.command === 'freeze') {
  result = freezeRun(resolve(args['run-dir']));
} else if (args.command === 'gate') {
  result = gateRun(resolve(args['run-dir']));
} else if (args.command === 'retry') {
  result = retryRun(resolve(args['run-dir']), args.stage);
} else {
  throw new Error(`unknown command: ${args.command}`);
}

function summarize(command, value) {
  if (args.json === 'full') return value;
  if (command === 'prepare') {
    return {
      command,
      runId: value.runId,
      runDir: value.runDir,
      knowledge: value.knowledge
    };
  }
  if (command === 'spec') {
    return {
      command,
      valid: value.valid,
      errors: value.errors,
      target_id: value.designSpec?.target_id ?? '',
      component_count: value.componentMappings?.length ?? 0,
      token_count: value.tokenMappings?.length ?? 0
    };
  }
  if (command === 'runtime') {
    return {
      command,
      pass: value.pass,
      reused: value.reused,
      capture_count: value.captures?.length ?? 0,
      unique_image_count: value.visualAlias?.unique_image_count ?? value.uniqueImageCount ?? 0,
      transition_evidence_count: value.transitionEvidence?.length ?? 0,
      actions: value.actions
    };
  }
  if (command === 'freeze') {
    return {
      command,
      frozenAt: value.frozenAt,
      artifact_count: Object.keys(value.artifacts ?? {}).length
    };
  }
  if (command === 'gate') {
    return {
      command,
      verdict: value.verdict,
      complete: value.complete,
      error_count: value.errors?.length ?? 0,
      errors: value.errors,
      retryStage: value.retryStage,
      reviewId: value.reviewId,
      viewedImages: value.viewedImages
    };
  }
  return {command, ...value};
}

console.log(JSON.stringify(summarize(args.command, result), null, 2));
