import { deferredArray, IDB  } from '../src/persistence/local';
import "fake-indexeddb/auto";


import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('IDB Class', () => {
  const dbName = 'testDB';
  let idb: IDB;

  beforeEach(async () => {
    idb = new IDB({ name: dbName });
  });

  afterEach(async () => {
    await idb.clear();
    await idb.clearMetadata()
  });

  it('should initialize the database and object stores', async () => {
    // Simulate the request to ensure the database and object stores are created
    const request = indexedDB.open(dbName);
    const result = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    expect(result.objectStoreNames.contains(dbName)).toBe(true);
    expect(result.objectStoreNames.contains('metadata')).toBe(true);
  });

  it('should store and retrieve multiple entries', async () => {
    const entries = [['key1', 'value1'], ['key2', 'value2']] as [string, string][];
    await idb.put(entries);

    const allEntries = await idb.getAll();
    expect(allEntries).toContain('value1');
    expect(allEntries).toContain('value2');
  });

  it('should store and retrieve metadata', async () => {
    await idb.setMetadata('testKey', 'testValue');
    const value = await idb.getMetadata('testKey');

    expect(value).toBe('testValue');
  });

  it('should store and retrieve version', async () => {
    await idb.putVersion(1);
    const version = await idb.getVersion();

    expect(version).toBe(1);
  });

  it('should store and retrieve deferred array', async () => {
    const deferredArray: deferredArray = [{ data: "data", ts: 12 }, {data: "data2", ts: 24}];
    await idb.putDeferred(deferredArray);
    const retrievedArray = await idb.getDeferred();

    expect(retrievedArray).toEqual(deferredArray);
  });

  it('should clear all entries', async () => {
    const entries = [['key1', 'value1'], ['key2', 'value2']] as [string, string][];
    await idb.put(entries);

    await idb.clear();
    const allEntries = await idb.getAll();

    expect(allEntries.length).toBe(0);
  });

  it('should clear metadata', async () => {
    await idb.setMetadata('testKey', 'testValue');
    await idb.clearMetadata();

    const value = await idb.getMetadata('testKey');
    expect(value).toBeUndefined();
  });

  it('should handle concurrent transactions', async () => {
    const entries1 = [['key1', 'value1']] as [string, string][];
    const entries2 = [['key2', 'value2']] as [string, string][];

    await Promise.all([idb.put(entries1), idb.put(entries2)]);

    const allEntries = await idb.getAll();
    expect(allEntries).toContain('value1');
    expect(allEntries).toContain('value2');
  });
});
