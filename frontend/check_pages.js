/**
 * Check which pages are missing CompanyProvider
 * Run: node check_pages.js
 */
const fs = require('fs');
const path = require('path');

const appDir = path.join(__dirname, 'src/app');
const pages = [];

function findPages(dir, basePath = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.join(basePath, entry.name);
    
    if (entry.isDirectory()) {
      findPages(fullPath, relativePath);
    } else if (entry.name === 'page.tsx') {
      const content = fs.readFileSync(fullPath, 'utf8');
      const hasCompanyProvider = content.includes('CompanyProvider');
      const hasExportDefault = content.includes('export default');
      
      pages.push({
        path: relativePath,
        hasCompanyProvider,
        hasExportDefault
      });
    }
  }
}

findPages(appDir);

console.log('Pages missing CompanyProvider:');
pages
  .filter(p => !p.hasCompanyProvider && p.hasExportDefault)
  .forEach(p => console.log(`  - ${p.path}`));

console.log(`\nTotal pages: ${pages.length}`);
console.log(`Pages with CompanyProvider: ${pages.filter(p => p.hasCompanyProvider).length}`);
console.log(`Pages without CompanyProvider: ${pages.filter(p => !p.hasCompanyProvider && p.hasExportDefault).length}`);












