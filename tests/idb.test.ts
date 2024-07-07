import { IDB } from '../src/idb';
import { describe, test, expect } from 'vitest';
import "fake-indexeddb/auto";


describe('IDB', () => {
    test('get', async () => {
        const idb = new IDB('testDB');
        await idb.set('key1', 'value1');
        const result = await idb.get('key1');
        expect(result).toBe('value1');
    });

    test('getBulk', async () => {
        const idb = new IDB('testDB');
        await idb.set('key1', 'value1');
        await idb.set('key2', 'value2');
        const result = await idb.getBulk(['key1', 'key2']);
        expect(result).toEqual(['value1', 'value2']);
    });

    test('set', async () => {
        const idb = new IDB('testDB');
        await idb.set('key1', 'value1');
        const result = await idb.get('key1');
        expect(result).toBe('value1');
    });

    test('setBulk', async () => {
        const idb = new IDB('testDB');
        await idb.setBulk([['key1', 'value1'], ['key2', 'value2']]);
        const result1 = await idb.get('key1');
        const result2 = await idb.get('key2');
        expect(result1).toBe('value1');
        expect(result2).toBe('value2');
    });

    test('delBulk', async () => {
        const idb = new IDB('testDB');
        await idb.set('key1', 'value1');
        await idb.set('key2', 'value2');
        await idb.delBulk(['key1', 'key2']);
        const result1 = await idb.get('key1');
        const result2 = await idb.get('key2');
        expect(result1).toBeUndefined();
        expect(result2).toBeUndefined();
    });

    test('clear', async () => {
        const idb = new IDB('testDB');
        await idb.set('key1', 'value1');
        await idb.set('key2', 'value2');
        await idb.clear();
        const result1 = await idb.get('key1');
        const result2 = await idb.get('key2');
        expect(result1).toBeUndefined();
        expect(result2).toBeUndefined();
    });

    test('keys', async () => {
        const idb = new IDB('testDB');
        await idb.set('key1', 'value1');
        await idb.set('key2', 'value2');
        const result = await idb.keys();
        expect(result).toEqual(['key1', 'key2']);
    });

    test('values', async () => {
        const idb = new IDB('testDB');
        await idb.set('key1', 'value1');
        await idb.set('key2', 'value2');
        const result = await idb.values();
        expect(result).toEqual(['value1', 'value2']);
    });

    test('setMetadata', async () => {
        const idb = new IDB('testDB');
        await idb.setMetadata('metadata1', 'value1');
        const result = await idb.getMetadata('metadata1');
        expect(result).toBe('value1');
    });

    test('getMetadata', async () => {
        const idb = new IDB('testDB');
        await idb.setMetadata('metadata1', 'value1');
        const result = await idb.getMetadata('metadata1');
        expect(result).toBe('value1');
    });
});