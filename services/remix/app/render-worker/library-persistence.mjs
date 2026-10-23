import { createHash } from 'node:crypto';

const unchanged = Symbol('unchanged-library');
export const unchangedLibrary = (value) => ({ [unchanged]: true, value });
export const serializeLibrary = (library) => JSON.stringify(library);

export const createDeduplicatedLibraryWriter = (write) => {
  let persistedDigest = null;
  return async (library) => {
    const serialized = serializeLibrary(library);
    const digest = createHash('sha256').update(serialized).digest('hex');
    if (digest === persistedDigest) return false;
    await write(library, serialized);
    // Advance only after durable persistence. Failed writes remain retryable.
    // Keep only the digest, not another complete copy of the library JSON.
    persistedDigest = digest;
    return true;
  };
};

// One load per cache generation. An invalidated load must neither restore an
// old snapshot nor clear a newer pending load when it eventually settles.
export const createLibraryReadCache = (load) => {
  let cached = null;
  let inflight = null;
  let generation = 0;
  const read = () => {
    if (cached !== null) return Promise.resolve(cached);
    if (inflight) return inflight;
    const startedAt = generation;
    const operation = Promise.resolve().then(load).then(
      (value) => {
        if (startedAt !== generation) return read();
        cached = value;
        return value;
      },
      (error) => {
        if (startedAt !== generation) return read();
        throw error;
      },
    ).finally(() => {
      if (inflight === operation) inflight = null;
    });
    inflight = operation;
    return operation;
  };
  return {
    read,
    version: () => generation,
    store(value) {
      generation += 1;
      cached = value;
      inflight = null;
    },
    invalidate(expected = generation) {
      if (expected !== generation) return false;
      generation += 1;
      cached = null;
      inflight = null;
      return true;
    },
  };
};

export async function persistLibraryUpdate(library, updater, write) {
  const result = await updater(library);
  // Opt-in only: returning false/null alone does not imply there was no change.
  if (result?.[unchanged] === true) return result.value;
  await write(library);
  return result;
}
