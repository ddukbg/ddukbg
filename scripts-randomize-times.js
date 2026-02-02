const fs = require('fs');
const path = require('path');

const contentDir = path.join(__dirname, 'content');
const files = fs.readdirSync(contentDir).filter(f => f.endsWith('.md'));

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomTime() {
  const h = randInt(0, 23);
  const m = randInt(0, 59);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function updateFrontMatterDate(md) {
  // Match YAML front matter block
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fmMatch) return { changed: false, md };

  const fm = fmMatch[1];
  const lines = fm.split('\n');
  let changed = false;

  const outLines = lines.map(line => {
    const m = line.match(/^date:\s*(.*)$/);
    if (!m) return line;

    let raw = m[1].trim();
    // Remove surrounding quotes if present
    const quote = (raw.startsWith('"') && raw.endsWith('"')) ? '"' : (raw.startsWith("'") && raw.endsWith("'")) ? "'" : null;
    if (quote) raw = raw.slice(1, -1).trim();

    // raw can be: YYYY-MM-DD, YYYY-MM-DD HH:mm, YYYY-MM-DD HH:mm:ss, ISO string
    const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
    if (!dateOnly) return line; // leave untouched

    const datePart = dateOnly[1];
    const t = randomTime();
    const newRaw = `${datePart} ${t}`;

    changed = true;
    const wrapped = quote ? `${quote}${newRaw}${quote}` : newRaw;
    return `date: ${wrapped}`;
  });

  const newFm = outLines.join('\n');
  const newMd = md.replace(fmMatch[0], `---\n${newFm}\n---\n`);
  return { changed, md: newMd };
}

let touched = 0;
for (const f of files) {
  const p = path.join(contentDir, f);
  const md = fs.readFileSync(p, 'utf8');
  const { changed, md: next } = updateFrontMatterDate(md);
  if (changed) {
    fs.writeFileSync(p, next);
    touched++;
    console.log(`Updated: ${f}`);
  } else {
    console.log(`Skipped: ${f}`);
  }
}

console.log(`\nDone. Updated ${touched}/${files.length} files.`);
