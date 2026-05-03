import Database from 'better-sqlite3';

const db = new Database('G:/Orikarma-mainfold-navigation-mempalace-agent/config/cold_memory.sqlite3', { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables.map(t => t.name).join(', '));

for (const t of tables) {
  const cols = db.prepare('PRAGMA table_info(' + t.name + ')').all();
  console.log('\n=== ' + t.name + ' ===');
  console.log('Columns:', cols.map(c => c.name + ' (' + c.type + ')').join(', '));
  try {
    const rows = db.prepare('SELECT * FROM ' + t.name + ' ORDER BY rowid DESC LIMIT 5').all();
    console.log('Last 5 rows:');
    for (const r of rows) {
      console.log(JSON.stringify(r, null, 2));
    }
  } catch(e) {
    console.log('Query error:', e.message);
  }
}

db.close();
