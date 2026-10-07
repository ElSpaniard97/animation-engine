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

const shot = { name: 'Knight', artwork, settings: { ...settings } };
const clip = {
  name: 'Clip',
  video: '/api/jobs/' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12) + '/video',
  settings,
};
const ratioSchema = { ...schema, ratio: { type: 'option', values: ['16:9', '9:16'] } };

test('round-trips a sequence of image and generated shots', () => {
  const project = { name: 'Knight', ratio: '16:9', shots: [shot, clip] };
  assert.deepEqual(parseProject(serializeProject(project), ratioSchema), project);
});

test('opens a version 1 project as a single shot', () => {
  const text = JSON.stringify({
    version: 1,
    name: 'Knight',
    artwork,
    settings: { ...settings, ratio: '9:16' },
  });
  assert.deepEqual(parseProject(text, ratioSchema), { name: 'Knight', ratio: '9:16', shots: [shot] });
});

test('accepts numbers where the form saved strings', () => {
  const text = serializeProject({
    ratio: '16:9',
    shots: [{ ...shot, settings: { ...settings, strength: 30 } }],
  });
  assert.equal(parseProject(text, ratioSchema).shots[0].settings.strength, 30);
});

test('defaults and trims names', () => {
  const text = serializeProject({
    ratio: '16:9',
    shots: [
      { artwork, settings },
      { name: 'x'.repeat(300), artwork, settings },
    ],
  });
  const project = parseProject(text, ratioSchema);
  assert.equal(project.name, 'Untitled project');
  assert.equal(project.shots[0].name, 'Shot 1');
  assert.equal(project.shots[1].name.length, 150);
});

test('fills in settings that older projects did not have', () => {
  const withTransition = {
    ...ratioSchema,
    transition: { type: 'option', values: ['cut', 'crossfade'] },
  };
  const text = serializeProject({ ratio: '16:9', shots: [shot] });
  assert.equal(parseProject(text, withTransition).shots[0].settings.transition, 'cut');
  const bad = serializeProject({
    ratio: '16:9',
    shots: [{ ...shot, settings: { ...settings, transition: 'wipe' } }],
  });
  assert.throws(() => parseProject(bad, withTransition));
});

test('keeps an optional music track', () => {
  const music = { name: 'Theme', audio: 'data:audio/mpeg;base64,AAAA', volume: 65 };
  const project = { name: 'Knight', ratio: '16:9', shots: [shot], music };
  assert.deepEqual(parseProject(serializeProject(project), ratioSchema).music, music);
  assert.equal(parseProject(serializeProject({ ...project, music: null }), ratioSchema).music, undefined);
  for (const bad of [
    { ...music, audio: 'https://example.com/theme.mp3' },
    { ...music, audio: 'data:text/html;base64,AAAA' },
    { ...music, volume: 101 },
    { ...music, volume: 'loud' },
    'theme.mp3',
  ]) {
    assert.throws(() => parseProject(serializeProject({ ...project, music: bad }), ratioSchema));
  }
});

test('rejects invalid projects', () => {
  const v2 = (shots, extra = {}) => JSON.stringify({ version: 2, ratio: '16:9', shots, ...extra });
  const cases = [
    'not json',
    JSON.stringify({ version: 3, ratio: '16:9', shots: [shot] }),
    JSON.stringify({
      version: 1,
      artwork: 'https://example.com/a.png',
      settings: { ...settings, ratio: '16:9' },
    }),
    JSON.stringify({ version: 1, artwork }),
    v2([]),
    v2('nope'),
    v2([shot], { ratio: '4:3' }),
    v2(Array(51).fill(shot)),
    v2([{ ...shot, artwork: 'https://example.com/a.png' }]),
    v2([{ ...clip, video: 'https://example.com/clip.mp4' }]),
    v2([{ ...clip, video: '/api/jobs/../../secret/video' }]),
    v2([{ name: 'No settings', artwork }]),
    v2([{ ...shot, settings: { ...settings, motion: 'spin' } }]),
    v2([{ ...shot, settings: { ...settings, strength: '31' } }]),
    v2([{ ...shot, settings: { ...settings, strength: 'lots' } }]),
    v2([{ ...shot, settings: { ...settings, vignette: 'yes' } }]),
    v2([{ ...shot, settings: { ...settings, title: 'x'.repeat(121) } }]),
  ];
  for (const text of cases) assert.throws(() => parseProject(text, ratioSchema), undefined, text);
});
