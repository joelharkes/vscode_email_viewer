import { randomBytes } from 'crypto';

export function getNonce(): string {
	return randomBytes(16).toString('hex');
}