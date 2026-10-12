import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto?.subtle) (globalThis as any).crypto = webcrypto;
