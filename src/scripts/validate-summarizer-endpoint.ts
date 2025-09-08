import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables (.env.local preferred, then .env)
(() => {
  try {
    const cwd = process.cwd();
    const envPath = path.join(cwd, '.env');
    const localPath = path.join(cwd, '.env.local');
    if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
    if (fs.existsSync(localPath)) dotenv.config({ path: localPath }); // local overrides
    if (!fs.existsSync(envPath) && !fs.existsSync(localPath)) dotenv.config();
  } catch {
    dotenv.config();
  }
})();

function env(name: string, required = false): string | undefined {
  const v = process.env[name];
  if (required && (!v || !v.trim())) {
    throw new Error(`${name} is required`);
  }
  return v;
}

async function main() {
  const host = env('DATABRICKS_HOST') || env('DATABRICKS_WORKSPACE_URL', true)!;
  const token = env('DATABRICKS_TOKEN', true)!;
  const endpoint = env('AI_SUMMARIZER_ENDPOINT', true)!; // e.g., /serving-endpoints/wavelistener-summarizer/invocations
  const mode = (env('AI_SUMMARIZER_PAYLOAD_MODE') || 'messages').toLowerCase();
  const timeoutMs = parseInt(process.env.AI_SUMMARIZER_TIMEOUT_MS || '15000', 10);

  const url = host.replace(/\/$/, '') + endpoint;

  const testPrompt = `You are an expert classroom observer. Summarize concisely in JSON.
Return JSON object: {"overview":"...","teacher_actions":[{"action":"...","priority":"high"}]}`;

  const body = mode === 'input'
    ? { input: testPrompt }
    : {
        messages: [{ role: 'user', content: testPrompt }],
        max_tokens: 400,
        temperature: 0.1,
      };

  console.log('🔎 Validating summarizer endpoint...');
  console.log('  URL:', url);
  console.log('  Mode:', mode);

  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs,
      validateStatus: () => true,
    });

    console.log('✅ HTTP status:', res.status, res.statusText);

    const data = res.data;
    // Try to extract in common formats (chat, output, direct)
    const chatContent = data?.choices?.[0]?.message?.content;
    const output = data?.output;
    const preview = typeof chatContent === 'string' ? chatContent : (typeof output === 'string' ? output : JSON.stringify(output ?? data));
    console.log('🗒️  Model content (first 300 chars):');
    console.log(String(preview).slice(0, 300));

    const tryParse = (s: string) => {
      try { return JSON.parse(s); } catch { /* ignore */ }
      const stripped = s
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      try { return JSON.parse(stripped); } catch { /* ignore */ }
      const first = stripped.indexOf('{');
      const last = stripped.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        const slice = stripped.slice(first, last + 1);
        try { return JSON.parse(slice); } catch { /* ignore */ }
      }
      return null;
    };

    let parsed: any = null;
    if (typeof chatContent === 'string') parsed = tryParse(chatContent);
    if (!parsed && typeof output === 'string') parsed = tryParse(output);
    if (!parsed && output && typeof output === 'object') parsed = output;
    if (!parsed && data && typeof data === 'object' && (data.overview || data.themes)) parsed = data;

    if (parsed) {
      console.log('🧩 Parsed JSON keys:', Object.keys(parsed));
    } else {
      console.log('ℹ️ Could not extract strict JSON. If content uses markdown fences, this is expected.');
    }
  } catch (err: any) {
    console.error('❌ Summarizer validation failed:', err?.message || err);
    process.exitCode = 1;
  }
}

main();
