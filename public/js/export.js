import { $ } from './dom.js';
import { download } from './files.js';

const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

function setControlsDisabled(disabled) {
  document.querySelectorAll('button,input,select').forEach((el) => (el.disabled = disabled));
}

/**
 * Records the shot in real time with MediaRecorder. Playback drives the recording; the editor's
 * tick loop calls `editor.recording.stop()` when the shot reaches its end.
 */
export async function exportVideo(editor) {
  if (editor.exporting) return;
  if (!window.MediaRecorder || !editor.canvas.captureStream) {
    return editor.message('Video export is unavailable in this browser. Try Chrome or Edge.');
  }
  const mime = MIME_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return editor.message('WebM export is unavailable in this browser. Try Chrome or Edge.');

  let stream;
  const finish = () => {
    stream?.getTracks().forEach((track) => track.stop());
    editor.exporting = false;
    editor.playing = false;
    if (editor.video) {
      editor.video.pause();
      editor.video.loop = false;
    }
    $('play').textContent = '▶';
    setControlsDisabled(false);
  };

  try {
    editor.exporting = true;
    editor.playing = false;
    editor.t = 0;
    editor.draw();
    setControlsDisabled(true);
    stream = editor.canvas.captureStream(30);
    const chunks = [];
    const recording = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000 });
    editor.recording = recording;
    recording.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recording.onstop = () => {
      download(new Blob(chunks, { type: mime }), 'animation-engine-shot.webm');
      finish();
      editor.message('Video downloaded. WebM · ' + $('duration').value + ' seconds · no audio.');
    };
    recording.onerror = () => {
      finish();
      editor.message('Export failed. Try again in Chrome or Edge.');
    };
    recording.start();
    if (editor.video) {
      editor.video.currentTime = 0;
      editor.video.loop = true;
      await editor.video.play();
    }
    editor.playing = true;
    editor.message('Exporting your shot in real time. Keep this tab visible.');
  } catch {
    finish();
    editor.message('Export could not start. Try Chrome or Edge.');
  }
}
