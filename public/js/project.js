// Saved projects: a JSON file holding the output format and a sequence of shots. Each shot keeps
// its settings plus either its artwork as a data URL or a link to a local generation.
import { MAX_SHOTS } from './shots.js';

export const PROJECT_VERSION = 2;
const ARTWORK_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,/;
// Generated clips stay on this computer, so a project refers to them instead of embedding them.
const GENERATED_VIDEO = /^\/api\/jobs\/[a-f0-9-]{36}\/video$/;

/**
 * Describes what each setting may hold, read from the editor's form controls so the rules can't
 * drift from the UI: checkboxes are booleans, selects must match an option, ranges stay in bounds.
 */
export function schemaFromControls(controls) {
  const schema = {};
  for (const [key, el] of Object.entries(controls)) {
    if (el.type === 'checkbox') schema[key] = { type: 'boolean' };
    else if (el.tagName === 'SELECT')
      schema[key] = { type: 'option', values: Array.from(el.options, (o) => o.value) };
    else if (el.type === 'range' || el.type === 'number')
      schema[key] = { type: 'number', min: +el.min, max: +el.max };
    else schema[key] = { type: 'string', maxLength: el.maxLength > 0 ? el.maxLength : Infinity };
  }
  return schema;
}

function validSetting(value, rule) {
  switch (rule.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string' && value.length <= rule.maxLength;
    case 'option':
      return rule.values.includes(String(value));
    case 'number':
      return Number.isFinite(+value) && +value >= rule.min && +value <= rule.max;
  }
  return false;
}

function checkSettings(settings, schema) {
  if (!settings || typeof settings !== 'object') throw Error('Missing settings');
  for (const [key, rule] of Object.entries(schema)) {
    if (!validSetting(settings[key], rule)) throw Error('Invalid setting: ' + key);
  }
}

const cleanName = (name, fallback) => String(name || fallback).slice(0, 150);

// Settings added after a project format shipped, with the value older files implicitly used.
const SETTING_DEFAULTS = { transition: 'cut' };

function parseShot(shot, schema, number) {
  if (!shot || typeof shot !== 'object') throw Error('Invalid shot');
  let settings = shot.settings;
  if (settings && typeof settings === 'object') {
    settings = { ...settings };
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      if (key in schema && settings[key] === undefined) settings[key] = value;
    }
  }
  checkSettings(settings, schema);
  const parsed = { name: cleanName(shot.name, 'Shot ' + number), settings };
  if (typeof shot.artwork === 'string' && ARTWORK_DATA_URL.test(shot.artwork)) parsed.artwork = shot.artwork;
  else if (typeof shot.video === 'string' && GENERATED_VIDEO.test(shot.video)) parsed.video = shot.video;
  else throw Error('Missing artwork');
  return parsed;
}

/**
 * Returns {name, ratio, shots: [{name, settings, artwork | video}]} for a valid project, or throws.
 * `schema` covers the form's settings: `ratio` applies to the whole project, the rest to each shot.
 * Version 1 files (a single image shot) open as a one-shot sequence.
 */
export function parseProject(text, schema) {
  const project = JSON.parse(text);
  const { ratio: ratioRule, ...shotSchema } = schema;
  if (project.version === 1) {
    checkSettings(project.settings, schema);
    const { ratio, ...settings } = project.settings;
    const name = cleanName(project.name, 'Untitled shot');
    const shot = parseShot({ name, artwork: project.artwork, settings }, shotSchema, 1);
    return { name, ratio, shots: [shot] };
  }
  if (project.version !== PROJECT_VERSION) throw Error('Unsupported project version');
  if (ratioRule && !validSetting(project.ratio, ratioRule)) throw Error('Invalid setting: ratio');
  if (!Array.isArray(project.shots) || !project.shots.length || project.shots.length > MAX_SHOTS) {
    throw Error('Missing shots');
  }
  return {
    name: cleanName(project.name, 'Untitled project'),
    ratio: project.ratio,
    shots: project.shots.map((shot, i) => parseShot(shot, shotSchema, i + 1)),
  };
}

/** `shots`: [{name, settings, artwork | video}]. */
export function serializeProject({ name, ratio, shots }) {
  return JSON.stringify({ version: PROJECT_VERSION, name, ratio, shots });
}
