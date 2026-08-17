const { Client } = require('pg');

async function main() {
  const c = new Client({
    host: '127.0.0.1',
    port: 5432,
    database: 'tarhelahi_db',
    user: 'postgres',
    password: '2131380',
  });

  await c.connect();
  console.log('Connected to PostgreSQL database tarhelahi_db');

  const tablesRes = await c.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';"
  );

  const occurrences = [];

  for (const row of tablesRes.rows) {
    const tbl = row.table_name;
    const colsRes = await c.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND data_type IN ('text', 'character varying', 'jsonb');",
      [tbl]
    );

    for (const colRow of colsRes.rows) {
      const col = colRow.column_name;
      try {
        const checkRes = await c.query(
          `SELECT count(*) FROM "${tbl}" WHERE "${col}"::text LIKE '%tarhelahi.ir%' AND "${col}"::text NOT LIKE '%dl.tarhelahi.ir%';`
        );
        const count = parseInt(checkRes.rows[0].count, 10);
        if (count > 0) {
          occurrences.push({ tbl, col, count });
          console.log(`Found ${count} rows in table '${tbl}', column '${col}' containing 'tarhelahi.ir'`);
        }
      } catch (err) {
        // ignore errors on incompatible json/types
      }
    }
  }

  console.log('\n--- Performing Replacements ---');
  for (const { tbl, col, count } of occurrences) {
    // 1. Reset any dl.dl.tarhelahi.ir just in case
    await c.query(
      `UPDATE "${tbl}" SET "${col}" = REPLACE("${col}"::text, 'dl.tarhelahi.ir', 'tarhelahi.ir')::text WHERE "${col}"::text LIKE '%dl.tarhelahi.ir%';`
    );

    // 2. Perform replacement from tarhelahi.ir -> dl.tarhelahi.ir
    const updateRes = await c.query(
      `UPDATE "${tbl}" SET "${col}" = REPLACE("${col}"::text, 'tarhelahi.ir', 'dl.tarhelahi.ir')::text WHERE "${col}"::text LIKE '%tarhelahi.ir%';`
    );
    console.log(`Updated table '${tbl}', column '${col}': ${updateRes.rowCount} rows updated.`);
  }

  console.log('\n--- Verification ---');
  let remainingCount = 0;
  for (const { tbl, col } of occurrences) {
    const checkRes = await c.query(
      `SELECT count(*) FROM "${tbl}" WHERE "${col}"::text LIKE '%tarhelahi.ir%' AND "${col}"::text NOT LIKE '%dl.tarhelahi.ir%';`
    );
    const count = parseInt(checkRes.rows[0].count, 10);
    remainingCount += count;
    console.log(`Remaining non-dl links in ${tbl}.${col}: ${count}`);
  }

  const dlCountRes = await c.query(
    `SELECT count(*) FROM components_course_parts_lessons WHERE audio_url LIKE '%dl.tarhelahi.ir%' OR video_url LIKE '%dl.tarhelahi.ir%';`
  );
  console.log(`Total lessons now with dl.tarhelahi.ir: ${dlCountRes.rows[0].count}`);

  await c.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
