// File: src/benchmark.js
import { PLATFORM } from '../worker.js';
import { KV } from '../platform/kv.js';
import { D1 } from '../platform/d1.js';

const kv = new KV(PLATFORM.KV_NAMESPACE);
const d1 = new D1(PLATFORM.D1_NAMESPACE);

/**
 * Calculates the score benchmark for the given report ID.
 * @param {string} reportId - The ID of the report to calculate the score for.
 * @returns {Promise<number>} The calculated score benchmark.
 */
export async function calculateScoreBenchmark(reportId) {
  try {
    const report = await kv.get(`report:${reportId}`);
    if (!report) {
      throw new Error(`Report not found: ${reportId}`);
    }

    const scans = await d1.query(`SELECT * FROM scans WHERE report_id = ${reportId}`);
    const totalScans = scans.length;
    const passedScans = scans.filter((scan) => scan.passed).length;

    const score = (passedScans / totalScans) * 100;
    return score;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

/**
 * Updates the score benchmark for the given report ID.
 * @param {string} reportId - The ID of the report to update the score for.
 * @param {number} score - The new score benchmark.
 * @returns {Promise<void>} The updated score benchmark.
 */
export async function updateScoreBenchmark(reportId, score) {
  try {
    await kv.put(`score:${reportId}`, score.toString());
  } catch (error) {
    console.error(error);
    throw error;
  }
}