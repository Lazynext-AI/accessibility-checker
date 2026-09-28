// File: src/d1.js
import { PLATFORM } from '../worker.js';

export async function getIpScanCount(ip) {
  const count = await PLATFORM.d1.query(`SELECT COUNT(*) FROM scans WHERE ip = '${ip}' AND timestamp > NOW() - INTERVAL 1 HOUR`);
  return count ? count[0].count : 0;
}

export async function updateIpScanCount(ip, count) {
  await PLATFORM.d1.query(`INSERT INTO scans (ip, timestamp) VALUES ('${ip}', NOW())`);
}