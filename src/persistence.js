'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const STATE_FILE = 'focus-pin-state.json';
const ROLLING_BACKUP_FILE = 'focus-pin-state.backup.json';
const SNAPSHOT_DIR = 'focus-pin-backups';
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
const MAX_SNAPSHOTS = 30;
const MAX_STATE_BYTES = 128 * 1024 * 1024;

function isStateObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const value = JSON.parse(text);
  if (!isStateObject(value)) throw new Error('Saved state is not an object.');
  return value;
}

function pathsFor(userDataPath) {
  return {
    primary: path.join(userDataPath, STATE_FILE),
    rolling: path.join(userDataPath, ROLLING_BACKUP_FILE),
    snapshots: path.join(userDataPath, SNAPSHOT_DIR)
  };
}

async function listSnapshots(snapshotDir) {
  try {
    return (await fs.readdir(snapshotDir))
      .filter((name) => /^focus-pin-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/.test(name))
      .sort()
      .reverse()
      .map((name) => path.join(snapshotDir, name));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function loadState(userDataPath) {
  const locations = pathsFor(userDataPath);
  const candidates = [locations.primary, locations.rolling, ...(await listSnapshots(locations.snapshots))];
  const errors = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const filePath = candidates[index];
    try {
      const state = await readJson(filePath);
      return {
        state,
        recovered: index > 0,
        source: index === 0 ? 'primary' : index === 1 ? 'rolling-backup' : 'snapshot'
      };
    } catch (error) {
      if (error.code !== 'ENOENT') errors.push({ filePath, message: error.message });
    }
  }

  return { state: null, recovered: false, source: null, errors };
}

async function newestSnapshotTime(snapshotDir) {
  const snapshots = await listSnapshots(snapshotDir);
  if (!snapshots.length) return 0;
  try {
    return (await fs.stat(snapshots[0])).mtimeMs;
  } catch {
    return 0;
  }
}

async function pruneSnapshots(snapshotDir) {
  const snapshots = await listSnapshots(snapshotDir);
  await Promise.all(snapshots.slice(MAX_SNAPSHOTS).map((filePath) => fs.unlink(filePath).catch(() => {})));
}

async function saveState(userDataPath, state, options = {}) {
  if (!isStateObject(state)) throw new Error('Cannot save an invalid state.');
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) {
    throw new Error('Saved state is too large.');
  }

  const locations = pathsFor(userDataPath);
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.mkdir(locations.snapshots, { recursive: true });

  const temporary = `${locations.primary}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 });

  try {
    await fs.unlink(locations.rolling).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await fs.rename(locations.primary, locations.rolling).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await fs.rename(temporary, locations.primary);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }

  const lastSnapshot = await newestSnapshotTime(locations.snapshots);
  if (options.forceSnapshot || Date.now() - lastSnapshot >= SNAPSHOT_INTERVAL_MS) {
    const timestamp = new Date().toISOString().replaceAll(':', '-').replace('.', '-');
    const snapshotPath = path.join(locations.snapshots, `focus-pin-${timestamp}.json`);
    await fs.copyFile(locations.primary, snapshotPath);
    await pruneSnapshots(locations.snapshots);
  }

  return { saved: true, bytes: Buffer.byteLength(serialized, 'utf8') };
}

module.exports = {
  STATE_FILE,
  ROLLING_BACKUP_FILE,
  SNAPSHOT_DIR,
  SNAPSHOT_INTERVAL_MS,
  MAX_SNAPSHOTS,
  MAX_STATE_BYTES,
  pathsFor,
  loadState,
  saveState
};
