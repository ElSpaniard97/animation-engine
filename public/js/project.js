// Saved image projects: a JSON file holding the artwork as a data URL plus the shot settings.

export const PROJECT_VERSION = 1;
const ARTWORK_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,/;

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

/** Returns {name, artwork, settings} for a valid project, or throws. */
export function parseProject(text, schema) {
  const project = JSON.parse(text);
  if (project.version !== PROJECT_VERSION) throw Error('Unsupported project version');
  if (typeof project.artwork !== 'string' || !ARTWORK_DATA_URL.test(project.artwork)) {
    throw Error('Missing artwork');
  }
  if (!project.settings || typeof project.settings !== 'object') throw Error('Missing settings');
  for (const [key, rule] of Object.entries(schema)) {
    if (!validSetting(project.settings[key], rule)) throw Error('Invalid setting: ' + key);
  }
  return {
    name: String(project.name || 'Untitled shot').slice(0, 150),
    artwork: project.artwork,
    settings: project.settings,
  };
}

export function serializeProject({ name, artwork, settings }) {
  return JSON.stringify({ version: PROJECT_VERSION, name, artwork, settings });
}
