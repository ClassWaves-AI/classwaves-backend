const fs = require('fs');
const path = require('path');

const forbiddenPatterns = [
  {
    regex: /from ['"](?:\.\.\/)+adapters\/repositories\/databricks-[^'"/]+['"]/,
    message: 'Direct databricks repository import (use port interface instead)',
  },
  {
    regex: /from ['"][^'"]*databricks\.service['"]/,
    message: 'Direct databricks service import (should rely on DbPort abstraction)',
  },
  {
    regex: /require\(['"][^'"]*databricks[^'"]*['"]\)/,
    message: 'Direct require of databricks modules detected',
  },
];

function collectTsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectTsFiles(fullPath);
    }
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [fullPath] : [];
  });
}

function scanProviderBleed({ roots, patterns = forbiddenPatterns }) {
  const violations = [];
  const cwd = process.cwd();
  (roots || []).forEach((root) => {
    const absoluteRoot = path.resolve(cwd, root);
    const files = collectTsFiles(absoluteRoot);
    files.forEach((filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      patterns.forEach((pattern) => {
        lines.forEach((line, index) => {
          if (pattern.regex.test(line)) {
            violations.push({
              file: path.relative(cwd, filePath),
              line: index + 1,
              snippet: line.trim(),
              message: pattern.message,
            });
          }
        });
      });
    });
  });
  return violations;
}

module.exports = {
  scanProviderBleed,
  forbiddenPatterns,
};
