import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProject, schemaFromControls, serializeProject } from '../public/js/project.js';

const controls = {
  motion: { tagName: 'SELECT', type: 'select-one', options: [{ value: 'push' }, { value: 'still' }] },
  strength: { tagName: 'INPUT', type: 'range', min: '0', max: '30' },
  vignette: { tagName: 'INPUT', type: 'checkbox' },
  duration: { tagName: 'SELECT', type: 'select-one', options: [{ value: '5' }, { value: '10' }] },
  title: { tagName: 'INPUT', type: 'text', maxLength: 120 },
};
const schema = schemaFromControls(controls);
const settings = { motion: 'push', strength: '12', vignette: true, duration: '10', title: 'Dusk' };
const artwork = 'data:image/png;base64,AAAA';

test('reads the rules from form controls', () => {
  assert.deepEqual(schema, {
    motion: { type: 'option', values: ['push', 'still'] },
    strength: { type: 'number', min: 0, max: 30 },
    vignette: { type: 'boolean' },
    duration: { type: 'option', values: ['5', '10'] },
    title: { type: 'string', maxLength: 120 },
  });
});

test('round-trips a saved project', () => {
  const text = serializeProject({ name: 'Knight', artwork, settings });
  assert.deepEqual(parseProject(text, schema), { name: 'Knight', artwork, settings });
});

test('accepts numbers where the form saved strings', () => {
  const text = serializeProject({
    name: 'Knight',
    artwork,
    settings: { ...settings, strength: 30, duration: 5 },
  });
  assert.equal(parseProject(text, schema).settings.strength, 30);
});

test('defaults and trims the name', () => {
  const unnamed = JSON.stringify({ version: 1, artwork, settings });
  assert.equal(parseProject(unnamed, schema).name, 'Untitled shot');
  const long = serializeProject({ name: 'x'.repeat(300), artwork, settings });
  assert.equal(parseProject(long, schema).name.length, 150);
});

test('rejects invalid projects', () => {
  const cases = [
    'not json',
    JSON.stringify({ version: 2, artwork, settings }),
    JSON.stringify({ version: 1, artwork: 'https://example.com/a.png', settings }),
    JSON.stringify({ version: 1, artwork }),
    JSON.stringify({ version: 1, artwork, settings: { ...settings, motion: 'spin' } }),
    JSON.stringify({ version: 1, artwork, settings: { ...settings, strength: '31' } }),
    JSON.stringify({ version: 1, artwork, settings: { ...settings, strength: 'lots' } }),
    JSON.stringify({ version: 1, artwork, settings: { ...settings, vignette: 'yes' } }),
    JSON.stringify({ version: 1, artwork, settings: { ...settings, title: 'x'.repeat(121) } }),
  ];
  for (const text of cases) assert.throws(() => parseProject(text, schema), undefined, text);
});
