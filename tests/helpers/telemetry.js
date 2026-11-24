/**
 * Telemetry and Metrics Persistence Helper
 * Senior SDET Framework for TradePulse Q1 Automation
 */

const fs = require('fs');
const path = require('path');

const EVIDENCE_DIR = path.resolve(__dirname, '../../evidence');

if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function saveEvidence(filename, data) {
  const filePath = path.join(EVIDENCE_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[TELEMETRY] Evidence saved successfully: ${filePath}`);
  return filePath;
}

function loadEvidence(filename) {
  const filePath = path.join(EVIDENCE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

module.exports = {
  saveEvidence,
  loadEvidence,
  EVIDENCE_DIR
};
