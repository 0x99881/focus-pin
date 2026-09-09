'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const persistence = require('../src/persistence');

async function withTempDirectory(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'focus-pin-test-'));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('state save can be loaded again and creates a snapshot', async () => {
  await withTempDirectory(async (directory) => {
    const state = { version: 2, modifiedAt: new Date().toISOString(), papers: [{ id: 'paper-a' }], tasks: [] };
    await persistence.saveState(directory, state, { forceSnapshot: true });
    const loaded = await persistence.loadState(directory);
    assert.deepEqual(loaded.state, state);
    assert.equal(loaded.recovered, false);
    const snapshots = await fs.readdir(path.join(directory, persistence.SNAPSHOT_DIR));
    assert.equal(snapshots.length, 1);
  });
});

test('corrupt primary data automatically falls back to the rolling backup', async () => {
  await withTempDirectory(async (directory) => {
    const first = { version: 2, marker: 'first' };
    const second = { version: 2, marker: 'second' };
    await persistence.saveState(directory, first, { forceSnapshot: true });
    await persistence.saveState(directory, second);
    const paths = persistence.pathsFor(directory);
    await fs.writeFile(paths.primary, '{broken json', 'utf8');
    const loaded = await persistence.loadState(directory);
    assert.deepEqual(loaded.state, first);
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.source, 'rolling-backup');
  });
});

test('snapshot remains usable when both current and rolling files are damaged', async () => {
  await withTempDirectory(async (directory) => {
    const original = { version: 2, marker: 'snapshot' };
    await persistence.saveState(directory, original, { forceSnapshot: true });
    const paths = persistence.pathsFor(directory);
    await fs.writeFile(paths.primary, 'bad', 'utf8');
    await fs.writeFile(paths.rolling, 'also bad', 'utf8');
    const loaded = await persistence.loadState(directory);
    assert.deepEqual(loaded.state, original);
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.source, 'snapshot');
  });
});
