// The step log: one readable block per step, plus the same record as JSONL.
// Ticket 0001 step 7: log every step fully - element list, questions, answers,
// confidences, action, page after.

import { createHash } from "node:crypto";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { RunResult, StepRecord } from "./types.ts";

export interface StepLogOptions {
  /** Directory for the JSONL file. When null, the log only prints. */
  dir?: string | null;
  print?: (line: string) => void;
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;

export class StepLog {
  private readonly print: (line: string) => void;
  private readonly file: string | null;

  constructor(options: StepLogOptions = {}) {
    this.print = options.print ?? ((line) => console.log(line));
    if (options.dir) {
      mkdirSync(options.dir, { recursive: true });
      this.file = join(options.dir, "steps.jsonl");
    } else {
      this.file = null;
    }
  }

  get path(): string | null {
    return this.file;
  }

  write(record: StepRecord): void {
    this.printBlock(record);
    if (this.file) appendFileSync(this.file, `${JSON.stringify(record)}\n`);
  }

  private printBlock(record: StepRecord): void {
    const chooser = record.probability == null ? record.source : `${record.source} ${pct(record.probability)}`;
    this.print(`step ${record.step}  [${chooser}]  ${record.text}`);
    this.print(`  -> ${record.result}`);

    this.print(`  elements on ${record.path} (${record.elements.length}):`);
    for (const element of record.elements) {
      this.print(`    [${element.ref}] ${element.kind} ${element.role} "${element.name}"${element.disabled ? " (disabled)" : ""}`);
    }

    if (record.questions) {
      this.print(`  asked (${Object.keys(record.questions).length} question(s)):`);
      for (const [name, question] of Object.entries(record.questions)) {
        this.print(`    ${name}: ${question.type} - ${question.instructions}`);
        const criteria = Object.entries(question.criteria).map(([id, label]) => `${id}="${label}"`).join(" ");
        this.print(`      options: ${criteria}`);
      }
    }

    if (record.answers && Object.keys(record.answers).length > 0) {
      this.print("  answered:");
      for (const [name, answer] of Object.entries(record.answers)) {
        this.print(`    ${name}: ${JSON.stringify(answer)}`);
      }
    }

    if (record.options.length > 0) {
      this.print(`  confidences: ${record.options.map((option) => `${option.label ?? option.id} ${pct(option.probability)} (${option.part})`).join(", ")}`);
    }

    if (record.action) this.print(`  action: ${JSON.stringify(record.action)}`);
    this.print(`  page after: ${record.pageAfter.title || "(no title)"} | ${record.pageAfter.url}`);
    this.print("");
  }
}

/** Prints the run summary: decider versus planner counts, time, tokens, cost. */
export function printSummary(print: (line: string) => void, result: RunResult, goal: string): void {
  print("run summary");
  print(`  goal: ${goal}`);
  print(`  outcome: ${result.outcome}${result.reason ? ` - ${result.reason}` : ""}`);
  print(`  steps logged: ${result.steps.length}`);
  const reflex = result.stats.reflex;
  print(`  reflex (decider): ${reflex.calls} call(s), ${reflex.ms} ms, tokens in ${reflex.inputTokens} out ${reflex.outputTokens}, cost ${reflex.costUsd == null ? "unknown without usage pricing" : `$${reflex.costUsd.toFixed(4)}`}`);
  const planner = result.stats.planner;
  print(`  planner: ${planner.calls} call(s), ${planner.ms} ms, cost $${planner.costUsd.toFixed(4)}`);
}

/** A stable run id for the runs/ folder. */
export function newRunId(): string {
  return createHash("sha1").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 8);
}
