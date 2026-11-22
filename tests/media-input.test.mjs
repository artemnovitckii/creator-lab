import test from 'node:test';
import assert from 'node:assert/strict';
import {ChildProcess, execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pipeline} from '../lib/pipeline.mjs';
import {prepareAudio} from '../lib/providers.mjs';

const missingBinary = ['ffmpeg', 'ffprobe'].find(binary =>
  spawnSync(binary, ['-version'], {stdio: 'ignore'}).status !== 0);
const skip = missingBinary ? `${missingBinary} is unavailable on PATH` : false;
const videoUrl = 'https://test.cdninstagram.com/video.mp4';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'creator-lab-media-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  return root;
}

function serveFixture(t, bytes) {
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, videoUrl);
    return new Response(bytes, {headers: {'Content-Type': 'video/mp4'}});
  });
}

function assertInputWhitelists(args) {
  const input = args.indexOf('-i');
  const protocol = args.indexOf('-protocol_whitelist');
  const format = args.indexOf('-format_whitelist');
  assert.ok(protocol > 0 && protocol + 1 < input, `${args[0]} needs an input protocol whitelist`);
  assert.equal(args[protocol + 1], 'file');
  assert.ok(format > 0 && format + 1 < input, `${args[0]} needs an input demuxer whitelist`);
  const allowed = args[format + 1].split(',');
  for (const demuxer of ['hls', 'applehttp', 'concat', 'ffconcat', 'dash', 'subfile', 'data']) {
    assert.ok(!allowed.includes(demuxer), `${args[0]} must disallow ${demuxer}`);
  }
}

test('HLS presented as MP4 fails during restricted probing as a per-item error', {skip}, async t => {
  const root = await workspace(t);
  serveFixture(t, '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXT-X-ENDLIST\n');
  const pipeline = await new Pipeline(root, () => ({fireworks: 'test', jev: 'test'}), {
    transcriptionProvider: 'fireworks',
  }).init();
  const job = await pipeline.create({creator: 'tester'}, [{id: 'hls', ownerUsername: 'tester', videoUrl}]);
  const spawn = t.mock.method(ChildProcess.prototype, 'spawn');
  await pipeline.run(job.id);
  while (pipeline.active.has(job.id)) await new Promise(resolve => setTimeout(resolve, 10));
  await pipeline.writes.get(job.id);

  assert.equal(job.status, 'partial');
  assert.equal(job.posts[0].status, 'failed');
  assert.ok(job.posts[0].error);
  assert.equal(job.posts[0].transcript, null);
  assert.equal(globalThis.fetch.mock.callCount(), 1);
  assert.deepEqual(await readdir(join(root, 'tmp')), []);
  assert.equal(spawn.mock.callCount(), 1);
  assertInputWhitelists(spawn.mock.calls[0].arguments[0].args);
});

test('ffconcat presented as MP4 is rejected by the demuxer whitelist', {skip}, async t => {
  const root = await workspace(t);
  serveFixture(t, 'ffconcat version 1.0\n');

  await assert.rejects(prepareAudio({videoUrl}, root), /Format (?:'concat' )?not on whitelist/i);
  assert.deepEqual(await readdir(root), []);
});

test('real MP4 yields FLAC with input whitelists on every media read', {skip}, async t => {
  const root = await workspace(t);
  const fixture = join(root, 'video.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=64x64:d=1',
    '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'mpeg4', '-c:a', 'aac', fixture]);
  serveFixture(t, await readFile(fixture));

  const spawn = t.mock.method(ChildProcess.prototype, 'spawn');
  const {audio, duration} = await prepareAudio({videoUrl}, root);
  assert.equal(audio.toString('ascii', 0, 4), 'fLaC');
  assert.ok(Math.abs(duration - 1) < 0.1);
  assert.deepEqual(await readdir(root), ['video.mp4']);

  const calls = spawn.mock.calls.map(call => call.arguments[0].args);
  assert.deepEqual(calls.map(args => args[0]), ['ffprobe', 'ffmpeg', 'ffprobe']);
  for (const args of calls) assertInputWhitelists(args);
});
