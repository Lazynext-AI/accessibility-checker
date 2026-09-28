// File: src/kv.js
import { PLATFORM } from '../worker.js';

export async function getLicenseQuota(licenseId) {
  const quota = await PLATFORM.kv.get(`license:${licenseId}:quota`);
  return quota ? JSON.parse(quota) : { scans: 0 };
}

export async function updateLicenseQuota(licenseId, scans) {
  await PLATFORM.kv.put(`license:${licenseId}:quota`, JSON.stringify({ scans }));
}