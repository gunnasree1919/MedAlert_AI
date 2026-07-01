const fs = require('fs');

// Read the UTF-16 file
const content = fs.readFileSync('README.md', 'utf16le');

// Replace text
const updated = content
  .replace(/Lifeline-SOS/g, 'MedAlert AI')
  .replace(/Lifeline SOS/g, 'MedAlert AI');

// Write back with UTF-16 LE encoding and BOM
fs.writeFileSync('README.md', '\uFEFF' + updated, 'utf16le');

console.log('Updated README.md successfully!');
