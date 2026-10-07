import { customAlphabet } from 'nanoid';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

export const uid = (prefix: string) => `${prefix}_${nano()}`;

/** A device's id: 10 characters of [0-9a-z]. Also the node part of its sync stamps. */
export const deviceId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);
