#!/usr/bin/env node
import { retrieveSkills, buildAdditionalContext } from '../../packages/hook-bridge/retriever.mjs';

const prompt = process.argv.slice(2).join(' ') || '';
const matches = retrieveSkills({ prompt });
const ctx = buildAdditionalContext(prompt);
process.stdout.write(JSON.stringify({ matches, additional_context: ctx }, null, 2));
process.stdout.write('\n');
