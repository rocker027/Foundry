#!/usr/bin/env node
/** Recorder agent 入口 — 由 adapters 直接呼叫 hook-bridge/recorder.mjs */
export { recordEvent, resolveJsonlPath, readSessionEvents } from '../../packages/hook-bridge/recorder.mjs';
