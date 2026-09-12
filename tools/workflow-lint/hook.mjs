// Node >= 22 wymaga `with { type: 'json' }` dla importow JSON; dist @actions/workflow-parser importuje schemat JSON bez atrybutu.
// Hook dokleja atrybut w locie — parser pozostaje nietkniety (bez patchowania node_modules).
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function load(url, context, next) {
  if (url.endsWith('.json')) context = { ...context, importAttributes: { ...(context.importAttributes || {}), type: 'json' } };
  return next(url, context);
}`), import.meta.url);
