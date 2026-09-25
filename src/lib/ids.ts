import { customAlphabet } from 'nanoid';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);

export const uid = (prefix: string) => `${prefix}_${nano()}`;
