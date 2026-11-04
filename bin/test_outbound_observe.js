#!/usr/bin/env node
// Testy hooks/outbound-observe.js (2026-11-03): observe wysylki przez MCP — nigdy nie blokuje, loguje would_block
// po czytaniu tresci zewnetrznej, nie loguje odbiorcow/tresci, nie dotyka produkcyjnego logu bramek.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'outbound-observe.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-outbound-'));
const GATE_LOG = path.join(tmp, 'gates.jsonl');
const fails = [];
function check(name, ok, detail = '') {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : ` :: ${String(detail).slice(-400)}`));
  if (!ok) fails.push(name);
}
function transcript(names) {
  const p = path.join(tmp, `t-${names.join('-') || 'empty'}-${Math.random().toString(36).slice(2)}.jsonl`);
  const lines = names.map((n) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: n, input: {} }] } }));
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}
function run(input, raw) {
  try { fs.unlinkSync(GATE_LOG); } catch (e) { /* pierwszy przebieg */ }
  const r = spawnSync('node', [HOOK], { input: raw !== undefined ? raw : JSON.stringify(input), encoding: 'utf8',
    env: Object.assign({}, process.env, { PG_GATE_LOG: GATE_LOG }) });
  let entries = [];
  try { entries = fs.readFileSync(GATE_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (e) { /* brak wpisu */ }
  return { r, entries };
}
const SECRET_RECIPIENT = 'odbiorca-testowy@example.invalid';

let x = run({ tool_name: 'mcp__gmail-multi__gmail_send_email', tool_input: { to: SECRET_RECIPIENT, body: 'tajna tresc' },
  transcript_path: transcript(['Read', 'mcp__gmail-multi__gmail_get_email']) });
check('wysylka po czytaniu maila = would_block, exit 0, bez stdout/stderr, staly reason',
  x.r.status === 0 && !x.r.stdout && !x.r.stderr && x.entries.length === 1 && x.entries[0].event === 'would_block'
  && x.entries[0].gate === 'OUTBOUND' && x.entries[0].reason === 'wysylka MCP po czytaniu tresci zewnetrznej w sesji'
  && x.entries[0].via === 'mail', JSON.stringify(x));
check('log bez odbiorcy i tresci (PII)', !fs.readFileSync(GATE_LOG, 'utf8').includes(SECRET_RECIPIENT)
  && !fs.readFileSync(GATE_LOG, 'utf8').includes('tajna tresc'));

x = run({ tool_name: 'mcp__github__merge_pull_request', tool_input: {}, transcript_path: transcript(['Read', 'mcp__github__get_pull_request', 'mcp__github__get_file_contents']) });
check('merge po czytaniu wlasnego PR (GitHub) = ran, nie szum would_block', x.r.status === 0 && x.entries.length === 1 && x.entries[0].event === 'ran', JSON.stringify(x.entries));

x = run({ tool_name: 'mcp__zoho-mail__ZohoMail_sendReplyEmail', tool_input: {}, transcript_path: transcript(['mcp__zoho-mail__ZohoMail_SearchEmails']) });
check('zoho: odpowiedz po wyszukaniu maili = would_block', x.entries.length === 1 && x.entries[0].event === 'would_block', JSON.stringify(x.entries));

x = run({ tool_name: 'mcp__gmail-multi__gmail_send_email', tool_input: {}, transcript_path: transcript(['mcp__gmail-multi__calendar_list_events']) });
check('kalendarz (zaproszenia obcych) = odczyt zewnetrzny', x.entries.length === 1 && x.entries[0].event === 'would_block', JSON.stringify(x.entries));

x = run({ tool_name: 'mcp__57ab__reply', tool_input: {}, transcript_path: transcript(['WebFetch']) });
check('WebFetch liczy sie jako odczyt zewnetrzny (via=web)', x.entries.length === 1 && x.entries[0].event === 'would_block'
  && x.entries[0].via === 'web', JSON.stringify(x.entries));
x = run({ tool_name: 'mcp__github__merge_pull_request', tool_input: {}, transcript_path: transcript(['mcp__Claude_Browser__navigate', 'mcp__gmail-multi__gmail_get_email']) });
check('via = klasa PIERWSZEGO odczytu (przegladarka przed mailem)', x.entries.length === 1 && x.entries[0].via === 'browser', JSON.stringify(x.entries));
x = run({ tool_name: 'mcp__github__merge_pull_request', tool_input: {}, transcript_path: transcript(['Read']) });
check('ran nie ma pola via', x.entries.length === 1 && x.entries[0].event === 'ran' && !('via' in x.entries[0]), JSON.stringify(x.entries));
// Biezace narzedzia Zoho sa snake_case (audyt 2026-11-03: get_mail -> send_mail logowalo ran zamiast would_block).
for (const r of ['mcp__zoho-mail__ZohoMail_get_mail', 'mcp__zoho-mail__ZohoMail_list_mails', 'mcp__zoho-mail__ZohoMail_search_mail_advanced',
  'mcp__zoho-mail__ZohoMail_get_mail_original']) {
  x = run({ tool_name: 'mcp__zoho-mail__ZohoMail_send_mail', tool_input: {}, transcript_path: transcript([r]) });
  check(`zoho snake_case: ${r} -> send_mail = would_block via=mail`, x.entries.length === 1 && x.entries[0].event === 'would_block'
    && x.entries[0].via === 'mail', JSON.stringify(x.entries));
}

x = run({ tool_name: 'mcp__zoho-mail__ZohoMail_sendReplyEmail', tool_input: {}, transcript_path: transcript(['mcp__zoho-mail__ZohoMail_sendReplyEmail']) });
check('wczesniejsza WYSYLKA zoho nie jest odczytem zewnetrznym', x.entries.length === 1 && x.entries[0].event === 'ran', JSON.stringify(x.entries));

x = run({ tool_name: 'mcp__gmail-multi__gmail_send_email', tool_input: {}, transcript_path: path.join(tmp, 'brak.jsonl') });
check('transkrypt nieczytelny = skipped (nie cicha zielen), exit 0', x.r.status === 0 && x.entries.length === 1 && x.entries[0].event === 'skipped', JSON.stringify(x.entries));

for (const t of ['mcp__gmail-multi__gmail_get_email', 'mcp__desktop-commander__create_directory', 'Bash', 'mcp__github__get_issue', 'mcp__zoho-mail__ZohoMail_SearchEmails']) {
  x = run({ tool_name: t, tool_input: {}, transcript_path: transcript(['WebFetch']) });
  check(`nie-wysylka ${t}: brak wpisu`, x.r.status === 0 && x.entries.length === 0, JSON.stringify(x.entries));
}

x = run(null, '{zepsuty json');
check('zepsute wejscie = exit 0, skipped (nie cisza)', x.r.status === 0 && x.entries.length === 1 && x.entries[0].event === 'skipped', JSON.stringify(x.entries));

x = run({ toolName: 'mcp__gmail-multi__gmail_send_email', transcript_path: transcript(['WebFetch']) });
check('JSON bez tool_name (dryf formatu) = skipped, nie cisza', x.entries.length === 1 && x.entries[0].event === 'skipped', JSON.stringify(x.entries));

x = run({ tool_name: 'mcp__gmail-multi__gmail_send_email', tool_input: {} });
check('brak transcript_path = skipped (nie plik "undefined" w cwd)', x.entries.length === 1 && x.entries[0].event === 'skipped', JSON.stringify(x.entries));

x = run({ tool_name: 'mcp__zoho-mail__ZohoMail_forwardEmail', tool_input: {}, transcript_path: transcript(['mcp__zoho-mail__ZohoMail_getMailAccounts', 'mcp__zoho-mail__ZohoMail_getMessageContent']) });
check('zoho: przekazanie po przeczytaniu tresci maila = would_block', x.entries.length === 1 && x.entries[0].event === 'would_block', JSON.stringify(x.entries));
x = run({ tool_name: 'mcp__zoho-mail__ZohoMail_addVacationReplySelf', tool_input: {}, transcript_path: transcript(['mcp__zoho-mail__ZohoMail_getMailAccounts', 'mcp__zoho-mail__ZohoMail_deleteEmail']) });
check('zoho: konto/kasowanie to nie odczyt tresci -> auto-odpowiedz = ran', x.entries.length === 1 && x.entries[0].event === 'ran', JSON.stringify(x.entries));

// Czytanie porcjami: odczyt zewnetrzny za granica porcji (1 MB) i linia przecieta granica tez sa znalezione.
const big = path.join(tmp, 'big.jsonl');
const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(4000) } });
fs.writeFileSync(big, Array(600).fill(filler).join('\n') + '\n' + JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebFetch', input: {} }] } }) + '\n');
const hook = require(HOOK);
check('readExternal: trafienie po 2,4 MB (za granica porcji)', hook.readExternal(big) === 'web');
fs.writeFileSync(big, Array(600).fill(filler).join('\n') + '\n');
check('readExternal: brak trafienia w duzym pliku = false (nie null)', hook.readExternal(big) === false);
// Linia z odczytem PRZECIETA granica porcji (zaczyna sie 40 B przed 1 MB): bez przenoszenia reszty linii miedzy porcjami
// obie polowki sa nieparsowalne i trafienie ginie.
const CHUNK = 1 << 20;
const cut = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebFetch', input: { pad: 'y'.repeat(200) } }] } });
const head = 'z'.repeat(CHUNK - 40 - 1);
fs.writeFileSync(big, head + '\n' + cut + '\n');
check('readExternal: linia przecieta granica porcji tez trafia', fs.statSync(big).size > CHUNK && head.length + 1 < CHUNK
  && head.length + 1 + cut.length > CHUNK && hook.readExternal(big) === 'web');

// Matcher (prefiltr w settings.json) musi przepuszczac kazda wysylke rozpoznana przez hook — inaczej hook jej nie zobaczy.
const rx = new RegExp(`^(${hook.MATCHER})$`);
const samples = ['mcp__gmail-multi__gmail_send_email', 'mcp__57ab__send_message', 'mcp__zoho-mail__ZohoMail_sendReplyEmail',
  'mcp__57ab__reply', 'mcp__57ab__forward', 'mcp__57ab__trash_thread', 'mcp__gmail-multi__calendar_create_event',
  'mcp__github__merge_pull_request', 'mcp__github__push_files', 'mcp__bokun__reserve_booking',
  'mcp__zoho-mail__ZohoMail_forwardEmail', 'mcp__zoho-mail__ZohoMail_replyToEmail', 'mcp__zoho-mail__ZohoMail_createDraft',
  'mcp__zoho-mail__ZohoMail_deleteEmail', 'mcp__zoho-mail__ZohoMail_addVacationReplySelf', 'mcp__zoho-mail__ZohoMail_updateReplyToAddressSelf',
  'mcp__zoho-mail__ZohoMail_addSendMailDetailsSelf', 'mcp__zoho-mail__ZohoMail_emptyFolder', 'mcp__57ab__update_draft', 'mcp__57ab__delete_draft',
  'mcp__x__send_read_receipt', 'mcp__x__send_message_and_get_status',
  'mcp__scheduled-tasks__create_scheduled_task', 'mcp__scheduled-tasks__update_scheduled_task',
  // audyt 2026-11-03: snake_case Zoho i trwale zmiany stanu repo
  'mcp__zoho-mail__ZohoMail_send_mail', 'mcp__zoho-mail__ZohoMail_reply_to_mail', 'mcp__zoho-mail__ZohoMail_empty_folder',
  'mcp__zoho-mail__ZohoMail_create_signature', 'mcp__zoho-mail__ZohoMail_update_signature', 'mcp__zoho-mail__ZohoMail_updateUserEmailSelf',
  'mcp__zoho-mail__ZohoMail_update_display_name',
  'mcp__github__create_branch', 'mcp__github__update_pull_request', 'mcp__github__update_pull_request_branch', 'mcp__ccd_pr__set_auto_merge'];
const missed = samples.filter((s) => !rx.test(s) || !hook.isOutbound(s));
check('MATCHER i isOutbound obejmuja kanaly wysylki (gmail, zoho, github, bokun)', missed.length === 0, missed.join(','));
const reads = ['mcp__gmail-multi__gmail_get_email', 'mcp__zoho-mail__ZohoMail_SearchEmails', 'mcp__57ab__list_drafts', 'mcp__57ab__get_draft',
  'mcp__zoho-mail__ZohoMail_getSendMailDetails', 'mcp__zoho-mail__ZohoMail_getMessageContent', 'mcp__57ab__search_threads',
  'mcp__zoho-mail__ZohoMail_get_mail', 'mcp__zoho-mail__ZohoMail_list_mails', 'mcp__zoho-mail__ZohoMail_list_folders',
  'mcp__zoho-mail__ZohoMail_mark_folder_as_read', 'mcp__ccd_pr__get_status', 'mcp__github__get_pull_request'];
const caught = reads.filter((s) => rx.test(s) || hook.isOutbound(s));
check('MATCHER i isOutbound nie lapia odczytu (get/list/search)', caught.length === 0, caught.join(','));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('TESTY outbound-observe: ' + (fails.length ? `${fails.length} FAIL` : 'wszystkie OK'));
process.exit(fails.length ? 1 : 0);
