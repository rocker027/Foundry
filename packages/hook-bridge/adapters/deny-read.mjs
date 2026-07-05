import { isDeniedPath } from '../security.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function asString(v) {
  return typeof v === 'string' ? v : '';
}

function denyOutput() {
  return {
    permission: 'deny',
    user_message: 'Foundry blocked read of sensitive path (security denylist).',
    agent_message: 'Cannot read sensitive file per Foundry security policy.',
  };
}

function handleBeforeReadFile(payload) {
  const filePath = asString(
    payload.file_path || payload.filePath || payload.path || payload.file,
  );
  if (filePath && isDeniedPath(filePath)) {
    process.stdout.write(`${JSON.stringify(denyOutput())}\n`);
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify({ permission: 'allow' })}\n`);
}

async function main() {
  const raw = (await readStdin()).trim();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      process.stderr.write(`[foundry:deny-read] Invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`);
      process.stdout.write(`${JSON.stringify(denyOutput())}\n`);
      process.exit(2);
    }
  }
  handleBeforeReadFile(payload);
}

main().catch((err) => {
  process.stderr.write(`[foundry:deny-read] ${err instanceof Error ? err.message : String(err)}\n`);
  process.stdout.write(`${JSON.stringify(denyOutput())}\n`);
  process.exit(2);
});
